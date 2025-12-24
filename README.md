# SL CRM on Cloudflare (D1 + R2)

Cloudflare Worker CRM shell that matches the provided sidebar/dashboard layout and is ready to persist data in D1 and store files in R2. Static assets live in `public/`, served through the Worker with an assets binding. The Worker exposes lightweight JSON APIs for contacts, documents, uploads, and dashboard counts.

## Project structure

- `public/` — single-page UI mirroring the screenshot (nav, dashboard, tables).
- `src/index.ts` — Hono-powered Worker with D1 schema setup, seed data, and API routes.
- `schema.sql` — D1 schema and seed inserts (idempotent).
- `wrangler.toml` — bindings for D1 (`DB`), R2 (`FILES`), and static assets (`ASSETS`).

## Prerequisites

- Node 18+
- Cloudflare account with Wrangler authenticated: `npx wrangler login`

## Configure Cloudflare bindings

1. Create D1 and R2 resources (pick names that match or update `wrangler.toml`):

```bash
npx wrangler d1 create crmforall-db
npx wrangler d1 execute crmforall-db --file ./schema.sql
npx wrangler r2 create crmforall-files
```

2. Update `wrangler.toml` with the generated D1 `database_id` and the chosen R2 bucket names.

## Local development

```bash
npm install
npm run dev
```

- `wrangler dev --local --ip 0.0.0.0` boots the Worker, serves `public/`, and creates a local D1 (seeded automatically on first API call).
- The UI hits `/api/dashboard` for counts; other sections render demo data client-side unless you extend the API.
- The server binds to all network interfaces (`0.0.0.0`) by default, making it accessible on your local network.

### Accessing from other devices on your local network

1. Start the development server with `npm run dev`
2. Note the IP addresses shown in the terminal output (e.g., `http://192.168.0.47:8787`)
3. On another device connected to the same network, open a browser and navigate to `http://[YOUR_LOCAL_IP]:8787`

**Example**: If your local IP is `192.168.0.47`, access the site at `http://192.168.0.47:8787`

> **Note**: Authentication uses client-side localStorage, so user accounts created on one device won't be available on other devices unless you implement server-side user management.

## Deploy

```bash
npm run deploy
```

## Cloudflare Containers (Python)

This repo also ships a Python container app that serves the SPA and uses D1 + R2 over Cloudflare APIs.

### Required environment variables

- `CLOUDFLARE_ACCOUNT_ID`
- `D1_DATABASE_ID`
- `D1_API_TOKEN` (API token with D1 read/write)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `PORT` (optional, defaults to 8080)

### Local container run

```bash
docker build -t salesaid-python .
docker run --rm -p 8080:8080 \\
  -e CLOUDFLARE_ACCOUNT_ID=... \\
  -e D1_DATABASE_ID=... \\
  -e D1_API_TOKEN=... \\
  -e R2_ACCESS_KEY_ID=... \\
  -e R2_SECRET_ACCESS_KEY=... \\
  -e R2_BUCKET=... \\
  salesaid-python
```

### Cloudflare Containers (beta) notes

- Use the included `Dockerfile` as the container source.
- Configure the same environment variables in the container deployment.
- The app serves `public/` and exposes the same `/api/*` routes as the Worker.

## API overview (Worker)

- `GET /api/health` — sanity check.
- `GET /api/dashboard` — aggregated counts + recent pipeline/activity (from D1 or seeded defaults).
- `GET /api/:table` — generic fetch for allowed tables (`companies`, `contacts`, `products`, `orders`, `quotations`, `invoices`, `documents`, `shipping_schedules`, `tasks`, `notes`, `tags`).
- `POST /api/contacts` — create a contact (body: `company_id?`, `first_name`, `last_name`, `email?`, `phone?`, `role?`, `status?`).
- `POST /api/documents` — register an R2 file in D1 (body: `title`, `key`, `companyId?`, `contactId?`, `contentType?`, `size?`).
- `PUT /api/files/:key` — upload a file to R2 through the Worker (raw body).
- `GET /api/files/:key` — download from R2.

### Quick R2 upload example

```bash
curl -X PUT "http://localhost:8787/api/files/contracts/contract.pdf" \
  -H "content-type: application/pdf" \
  --data-binary @./contract.pdf
```

Then register metadata in D1:

```bash
curl -X POST "http://localhost:8787/api/documents" \
  -H "content-type: application/json" \
  -d '{"title":"Contract.pdf","key":"contracts/contract.pdf","companyId":1}'
```

## Frontend notes

- Sidebar, spacing, and colors mirror the provided screenshot; Lucide icons are loaded from CDN.
- The UI is single-page and switches sections via JS; API-backed data is wired for the dashboard and can be extended for the other tables.
- Mobile: sidebar collapses into a wrapped row layout under 960px.

## Next steps

- Wire remaining table views to live D1 queries/mutations.
- Add auth (e.g., Cloudflare Access or JWT) before exposing write endpoints publicly.
- Add schema migrations via `wrangler d1 migrations` for production changes.
