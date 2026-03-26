# Mango CRM

A full-stack CRM application built with **Node.js / TypeScript** and **MongoDB**.

## Features

- **Companies, Contacts, Products** — full CRUD management
- **Quotations** — line-item quotations with PDF preview and print
- **Orders & Invoices** — order and invoice tracking with file attachments
- **Shipping Schedules** — shipment tracking with factory exit, ETC, ETD, ETA dates
- **Sample Shipments** — sample tracking workflow
- **Tasks** — task management with assignees and due dates
- **Analytics Dashboard** — KPI, operations, finance, and forecasting at `/analytics`
- **File Uploads** — attach PDFs and images to invoices and orders
- **Authentication** — JWT-based user login and session management
- **Tags** — flexible tagging across records
- **Responsive UI** — desktop and mobile layouts

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Database**: MongoDB
- **Frontend**: Vanilla JS single-page app (no bundler)
- **Auth**: JWT tokens
- **File storage**: Local disk (`uploads/`)
- **Process manager**: PM2

## Project Structure

```
mango-crm/
├── src/
│   ├── server.ts          # Main Express server and API routes
│   ├── mongodb.ts         # MongoDB connection and schema helpers
│   ├── db.ts              # Database utility types
│   ├── analytics.ts       # Analytics endpoints
│   └── types.ts           # Shared TypeScript types
├── public/
│   ├── index.html         # Main app shell
│   ├── app.js             # Frontend single-page app
│   ├── styles.css         # Desktop styles
│   ├── mobile.css         # Mobile styles
│   └── analytics/         # Analytics dashboard (React + ECharts)
├── scripts/
│   ├── init-admin.js              # Seed first admin user
│   ├── generate-password-hash.js  # Password hash utility
│   ├── migrate-to-mongodb.js      # Migration helper
│   ├── backup-mongodb.sh          # MongoDB backup script
│   ├── backup.ps1                 # Windows backup script
│   └── deploy-node.sh             # Node.js deploy script
├── dist/                  # Compiled JS output (git-ignored)
├── uploads/               # Uploaded files (git-ignored)
├── Dockerfile             # Docker configuration
├── package.json
├── tsconfig.json
└── .env.example           # Environment variable template
```

## Setup

### Prerequisites

- Node.js 18+
- MongoDB 6+ (local or remote)
- npm

### Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment** — copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```

3. **Start the server**:
   ```bash
   npm run dev
   ```
   Server runs on `http://localhost:3000`

4. **Build for production**:
   ```bash
   npm run build
   npm start
   ```

### Analytics UI

The analytics dashboard lives in `public/analytics/` and is built with React + TypeScript + ECharts.

```bash
npm run build:analytics
```

This compiles `public/analytics/app.ts` into `public/analytics/dist/app.js`. Run before `npm run dev` if you want the analytics page locally.

## Environment Variables

Create a `.env` file based on `.env.example`:

```
# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=crmmango

# Server
PORT=3000
ALLOWED_ORIGINS=*

# Auth
AUTH_SECRET=your_secure_random_string_32_chars_min

# First admin user (seeded on first run if DB is empty)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your_password

# Optional: Shippo tracking API
SHIPPO_API_KEY=

# Optional: AI model
AI_MODEL=claude-haiku-4-5-20251001
```

Generate a secure `AUTH_SECRET`:
```bash
openssl rand -base64 32
```

## Admin User Setup

On first run the server auto-seeds an admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`.

To manually create or reset an admin user:
```bash
node scripts/init-admin.js "your-email@example.com" "your-password"
```

To generate a password hash:
```bash
node scripts/generate-password-hash.js "your-password" "your-email@example.com"
```

## Running with PM2

```bash
pm2 start dist/server.js --name mango-crm
pm2 save
```

## Docker

### Option 1 — Docker Compose (recommended)

Runs the app and MongoDB together with a single command.

1. **Copy and configure your environment file**:
   ```bash
   cp .env.example .env
   ```
   At minimum set `AUTH_SECRET`:
   ```bash
   echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
   ```

2. **Start everything**:
   ```bash
   docker compose up -d
   ```
   The app will be available at `http://localhost:3000`.

3. **Common commands**:
   ```bash
   docker compose logs -f app        # stream app logs
   docker compose logs -f mongo      # stream MongoDB logs
   docker compose restart app        # restart app only
   docker compose down               # stop and remove containers
   docker compose down -v            # stop and delete all data volumes
   ```

4. **Updating after code changes**:
   ```bash
   docker compose build app
   docker compose up -d app
   ```

> **Data persistence**: MongoDB data is stored in the `mango-crm-mongo` named volume.
> Uploaded files are stored in the `uploads` named volume.
> Both survive container restarts and `docker compose down`.

---

### Option 2 — Docker only (bring your own MongoDB)

If you already have MongoDB running elsewhere:

```bash
# Build the image
docker build -t mango-crm .

# Run the container
docker run -d \
  --name mango-crm \
  -p 3000:3000 \
  -e MONGODB_URI=mongodb://your-mongo-host:27017 \
  -e MONGODB_DB_NAME=crmmango \
  -e AUTH_SECRET=your_secret \
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD=yourpassword \
  -v $(pwd)/uploads:/app/uploads \
  mango-crm
```

Or use an env file:
```bash
docker run -d --name mango-crm -p 3000:3000 --env-file .env \
  -v $(pwd)/uploads:/app/uploads mango-crm
```

## Troubleshooting

### Login Issues

Test login with curl:
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "your@email.com", "password": "yourpassword"}'
```

If login fails, reset the admin user:
```bash
node scripts/init-admin.js "your@email.com" "newpassword"
```

### MongoDB Connection

Check your `MONGODB_URI` in `.env`. For a local instance:
```bash
mongosh mongodb://localhost:27017
```

### TypeScript Build Errors

```bash
npm run check   # type-check only
npm run build   # full compile
```

## Analytics API Endpoints

All endpoints require a valid JWT (`Authorization: Bearer <token>`) and are scoped to the authenticated user's data.

| Endpoint | Description |
|---|---|
| `GET /api/kpis` | KPI cards, pipeline, invoice aging |
| `GET /api/timeseries` | Revenue / orders / invoices over time |
| `GET /api/breakdown` | Breakdown by company, product, status |
| `GET /api/forecast` | Forecast with confidence band and MAPE |
| `GET /api/data-quality` | Missing fields, orphans, duplicates |
| `POST /api/ai/research` | AI-powered CRM data questions |
| `POST /api/ai/propose` | AI-proposed record updates (read-only) |

## License

MIT License

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request
