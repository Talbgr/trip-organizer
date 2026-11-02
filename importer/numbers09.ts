// Reader for the XML-based Numbers file format (Numbers '08/'09, still written by
// Numbers when a document was created in that format). The file is a zip with a
// single `index.xml`; tables live in `ls:workspace` > ... > `sf:tabular-model`.
//
// This module only turns the file into plain grids (text, links, fill color and
// merge info per cell, plus each table's canvas position). Interpreting those grids
// as a trip is done in `interpret.ts`.

import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Cell {
  text: string;
  /** Raw stored value for numbers (`sf:v`) so "11.10" style titles keep their digits. */
  number: string | null;
  /** Seconds since 2001-01-01T00:00:00Z for date cells. */
  date: number | null;
  links: string[];
  fill: Rgb | null;
  colSpan: number;
  rowSpan: number;
}

export interface Table {
  /** Internal Numbers table name (not user visible; usually auto-generated). */
  name: string;
  sheet: string;
  index: number;
  x: number;
  y: number;
  numRows: number;
  numCols: number;
  /** cells[row][col]; null for empty positions and for positions covered by a merge. */
  cells: (Cell | null)[][];
}

type XNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: true,
  htmlEntities: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function tagOf(n: XNode): string | null {
  for (const k of Object.keys(n)) if (k !== ':@') return k;
  return null;
}
function kids(n: XNode): XNode[] {
  const t = tagOf(n);
  const v = t ? n[t] : undefined;
  return Array.isArray(v) ? (v as XNode[]) : [];
}
function attrs(n: XNode): Record<string, string> {
  return (n[':@'] as Record<string, string>) ?? {};
}
function child(n: XNode, tag: string): XNode | undefined {
  return kids(n).find((k) => tagOf(k) === tag);
}
function* walk(n: XNode): Generator<XNode> {
  yield n;
  for (const k of kids(n)) yield* walk(k);
}

export function readNumbers09(file: Uint8Array): Table[] {
  const zip = unzipSync(file);
  const entry = Object.keys(zip).find((k) => k === 'index.xml' || k.endsWith('/index.xml'));
  if (!entry) {
    throw new Error('Not an XML-format Numbers document (index.xml missing). Export the workbook again from Numbers.');
  }
  const root = parser.parse(strFromU8(zip[entry]!)) as XNode[];

  // Index every element that carries an id, and named styles by ident, for style inheritance.
  const byId = new Map<string, XNode>();
  const byIdent = new Map<string, XNode>();
  for (const top of root) {
    for (const n of walk(top)) {
      const a = attrs(n);
      if (a['sfa:ID']) byId.set(a['sfa:ID'], n);
      if (a['sf:ident'] && tagOf(n) === 'sf:cell-style') byIdent.set(a['sf:ident'], n);
    }
  }

  const fillCache = new Map<string, Rgb | null>();
  const fillOfStyle = (id: string | undefined, depth = 0): Rgb | null => {
    if (!id || depth > 20) return null;
    if (fillCache.has(id)) return fillCache.get(id)!;
    const style = byId.get(id);
    let result: Rgb | null = null;
    if (style) result = resolveFill(style, depth);
    fillCache.set(id, result);
    return result;
  };
  const resolveFill = (style: XNode, depth: number): Rgb | null => {
    const pm = child(style, 'sf:property-map');
    const fill = pm && child(pm, 'sf:fill');
    if (fill) {
      const color = child(fill, 'sf:color');
      if (!color) return null; // explicit "no fill" (sf:null)
      const a = attrs(color);
      return { r: Number(a['sfa:r']), g: Number(a['sfa:g']), b: Number(a['sfa:b']) };
    }
    const parent = attrs(style)['sf:parent-ident'];
    const p = parent ? byIdent.get(parent) : undefined;
    return p ? resolveFill(p, depth + 1) : null;
  };

  const tables: Table[] = [];
  for (const top of root) {
    for (const ws of walk(top)) {
      if (tagOf(ws) !== 'ls:workspace') continue;
      const sheet = attrs(ws)['ls:workspace-name'] ?? '';
      for (const info of walk(ws)) {
        const model = kids(info).find((k) => tagOf(k) === 'sf:tabular-model');
        if (!model) continue;
        const geom = child(info, 'sf:geometry');
        const pos = geom && child(geom, 'sf:position');
        tables.push(readTable(model, sheet, tables.length, pos ? attrs(pos) : {}, fillOfStyle));
      }
    }
  }
  return tables;
}

function readTable(
  model: XNode,
  sheet: string,
  index: number,
  pos: Record<string, string>,
  fillOfStyle: (id: string | undefined) => Rgb | null,
): Table {
  const grid = child(model, 'sf:grid');
  if (!grid) throw new Error(`table ${index}: no grid`);
  const ga = attrs(grid);
  const numRows = Number(ga['sf:numrows']);
  const numCols = Number(ga['sf:numcols']);
  const ds = child(grid, 'sf:datasource');
  const cells: (Cell | null)[][] = Array.from({ length: numRows }, () => Array<Cell | null>(numCols).fill(null));
  const covered: boolean[][] = Array.from({ length: numRows }, () => Array<boolean>(numCols).fill(false));

  // Cells are listed in row-major order. Positions covered by an earlier cell's
  // row/col span are skipped. `sf:s` elements are optional markers for covered
  // positions that some saves emit and others don't, so they never take a position.
  let pos_ = 0;
  const total = numRows * numCols;
  const nextFree = () => {
    while (pos_ < total && covered[Math.floor(pos_ / numCols)]![pos_ % numCols]) pos_++;
    return pos_;
  };
  for (const el of ds ? kids(ds) : []) {
    const tag = tagOf(el);
    if (!tag || tag === '#text' || tag === 'sf:s') continue;
    const at = nextFree();
    if (at >= total) throw new Error(`table ${index}: more cells than grid positions`);
    const row = Math.floor(at / numCols);
    const col = at % numCols;
    pos_++;
    const a = attrs(el);
    const colSpan = Number(a['sf:col-span'] ?? 1);
    const rowSpan = Number(a['sf:row-span'] ?? 1);
    for (let r = row; r < row + rowSpan && r < numRows; r++)
      for (let c = col; c < col + colSpan && c < numCols; c++) if (r !== row || c !== col) covered[r]![c] = true;

    const links: string[] = [];
    let text = '';
    let number: string | null = null;
    let date: number | null = null;
    if (tag === 'sf:t') text = readCellText(el, links);
    else if (tag === 'sf:n') {
      number = a['sf:v'] ?? null;
      text = number ?? '';
    } else if (tag === 'sf:d') {
      date = a['sf:cell-date'] != null ? Number(a['sf:cell-date']) : null;
    } else if (tag !== 'sf:g') {
      // Formulas / booleans / durations are not used in this workbook; keep any cached text.
      text = a['sf:v'] ?? '';
    }
    const fill = fillOfStyle(a['sf:s']);
    cells[row]![col] = { text, number, date, links, fill, colSpan, rowSpan };
  }
  return {
    name: attrs(model)['sf:name'] ?? '',
    sheet,
    index,
    x: Number(pos['sfa:x'] ?? 0),
    y: Number(pos['sfa:y'] ?? 0),
    numRows,
    numCols,
    cells,
  };
}

function readCellText(el: XNode, links: string[]): string {
  const ct = child(el, 'sf:ct');
  if (!ct) return '';
  const plain = attrs(ct)['sfa:s'];
  if (plain != null) return plain;
  const body = [...walk(ct)].find((n) => tagOf(n) === 'sf:text-body');
  if (!body) return '';
  const paras: string[] = [];
  for (const p of kids(body)) {
    if (tagOf(p) !== 'sf:p') continue;
    paras.push(inlineText(p, links));
  }
  return paras.join('\n');
}

function inlineText(n: XNode, links: string[]): string {
  let out = '';
  for (const k of kids(n)) {
    const t = tagOf(k);
    if (t === '#text') out += String(k['#text'] ?? '');
    else if (t === 'sf:br' || t === 'sf:lnbr') out += '\n';
    else if (t === 'sf:tab') out += '\t';
    else {
      if (t === 'sf:link') {
        const href = attrs(k)['href'];
        if (href && !links.includes(href)) links.push(href);
      }
      out += inlineText(k, links);
    }
  }
  return out;
}

export function rgbHex(c: Rgb | null): string | null {
  if (!c) return null;
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
}

/** Numbers stores dates as seconds since 2001-01-01 UTC. */
export function numbersDateToIso(seconds: number): string {
  return new Date(Date.UTC(2001, 0, 1) + seconds * 1000).toISOString().slice(0, 10);
}
