# Trip organizer

A phone-first Hebrew web app for our Japan trip, built from the trip workbook
(`data/workbook/trip.numbers`). The workbook is the source of truth: the app shows
its names, notes, links and colors as they are, organized as

**City → Neighborhood → Category** (🎡 attractions, 🛍️ shopping, 🍴 Adi / 🍴 Tal / 🍴 both).

Also included: the day-by-day itinerary (לו״ז), the general "נסיעות ואטרקציות" table
(כללי), and a **To book / To pay** list built from the red cells in the workbook, with an
optional reminder pop-up on opening (off by default; 🔕/🔔 on that page). "Booked" / "Paid" marks are shared between both phones.

Added in the app (shared between both phones, stored in the database, never written back
to the workbook):
- **Schedule** — the ✎ button at the top of לו״ז turns on edit mode: + adds an entry to a day
  (free text, optional time), ✎ / 🗑 edit or delete entries, and the workbook's own text for a
  day can be edited (✎), removed (🗑) and restored (↺). Workbook edits are stored as overrides;
  the workbook file is never changed. Either of us can change anything.
- **Done / missed** — a box next to every place and every schedule item: tap cycles
  ☐ → ✓ done → ✕ missed → ☐. Neighborhood cards on the city page show ✓/✕ counts.
  Whole areas (next to each neighborhood card and in its header) and whole days (under the date
  in לו״ז) have their own box; it does not change the marks inside them.
  Place marks are keyed by the workbook row, so re-importing a changed workbook can move them.
- **Hotels** — per place (each continuous stay in the itinerary, so Tokyo has two), from the
  🏨 מלונות tab or the top of a city page: name, whole stay or check-in day + nights, note/link,
  paid. Unpaid hotels show in להזמין/לשלם and in the opening pop-up; added hotels also
  appear on their nights in לו״ז. The workbook's own hotels are shown read-only.

## Deploy on Railway (≈5 minutes)

1. railway.com → **New Project → Deploy from GitHub repo** → pick `Talbgr/trip-organizer`
   (branch `main`). Railway finds the `Dockerfile` and `railway.json` on its own.
2. Keep the Booked/Paid marks across deploys with Railway's Postgres:
   **+ New → Database → PostgreSQL**, then in the app service → **Variables** add
   `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (a reference to the database's own variable;
   never paste the password itself). Without `DATABASE_URL` the app falls back to a SQLite file
   at `DB_PATH` (default `/data/state.db`), which only survives deploys on a mounted volume.
3. **Settings → Networking → Generate domain**. Open it on both phones and
   "Add to Home Screen" so it works like an app (and offline).

Every push to `main` redeploys automatically. The health check is `GET /healthz`.

## Updating the trip from a new version of the workbook

1. Replace `data/workbook/trip.numbers` with the new file (same name).
2. `npm run import` → regenerates `data/trip.json` and `docs/data-report.md`.
3. Read `docs/data-report.md` (anything unusual is listed there), run `npm test`, commit, push.

If the import stops with "Table X is not placed in layout.ts", a neighborhood table was
added or renamed in the workbook: add it under the right city in `importer/layout.ts`.
Booked/Paid marks are keyed by the item's name, so they survive re-imports.

## How the workbook is read

| Workbook | App |
|---|---|
| Sheet 2 tables under the labels טוקיו חלק 1/2, פוג׳י, קיוטו, אוסקה | Cities (Tokyo parts are one city, tagged חלק 1 / חלק 2) |
| Each table on sheet 2 (title row = name, its fill = color) | Neighborhood. Kyoto/Osaka tables are titled by date, so they appear by date |
| Section rows אטרקציות / קניות / מסעדות עדי, כשרות/טבעוניות / מסעדות (ל)טל / מסעדות משותפות | The five categories; anything else is "לא מסווג" |
| 15.11 table | Split by color: blue part → Kyoto, orange part → Osaka |
| Red cell fill | To book / To pay (merged by exact item name) |
| Green cell fill | "הוזמן" badge |
| Sheet 1 itinerary / "נסיעות ואטרקציות" | לו״ז / כללי tabs, as written |

Colors are meaningful only within a city; nothing is grouped across cities by color.

## Development

Requires Node 22.18+ (runs TypeScript directly).

```sh
npm install
npm run import        # workbook → data/trip.json + docs/data-report.md
npm test              # importer (checked against an independent LibreOffice reading) + API
npm run dev:server    # API on :3000
npm run dev:web       # Vite on :5173, proxies /api
npm run build && npm start   # production build served by the API server
```

Layout: `importer/` (Numbers XML reader + interpretation), `server/` (Fastify + SQLite),
`web/` (Preact, RTL), `shared/` (types), `test/`.
