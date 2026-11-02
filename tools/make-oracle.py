"""Build an independent reference of the workbook for the importer tests.

LibreOffice converts the Numbers file to .xlsx on its own (libetonyek), so its
output is a second opinion on cell text, fills and merges:

    soffice --headless --convert-to xlsx --outdir /tmp/conv data/workbook/trip.numbers
    python3 tools/make-oracle.py /tmp/conv/trip.xlsx > test/fixtures/oracle.json

Requires openpyxl.
"""
import json
import sys

import openpyxl

wb = openpyxl.load_workbook(sys.argv[1])
out = []
for ws in wb.worksheets:
    cells = {}
    for row in ws.iter_rows():
        for c in row:
            v = c.value
            fill = c.fill.fgColor.rgb if c.fill and c.fill.fill_type == "solid" else None
            if v is None and fill is None:
                continue
            cells[f"{c.row - 1},{c.column - 1}"] = {
                "text": None if v is None else str(v),
                "fill": None if fill is None else "#" + fill[2:].upper(),
            }
    out.append({"rows": ws.max_row, "cols": ws.max_column, "cells": cells,
                "merged": sorted(str(m) for m in ws.merged_cells.ranges)})
json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
