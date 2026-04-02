# SupplyFlow-CRM

A full-stack CRM application built with **Node.js / TypeScript** and **MongoDB**.

## Features

- **Companies, Contacts, Products** — full CRUD management
- **Quotations** — line-item quotations with PDF preview and print
- **Orders & Invoices** — order and invoice tracking with file attachments
- **Shipping Schedules** — shipment tracking with milestone status (Pending → In Production → Booking Confirmed → Cargo Closing → Shipped → Arrived → Delivered)
- **Sample Shipments** — sample tracking workflow
- **Meetings** — meeting planner with Calendar, List, and Today views; reminders; customer scheduling integration
- **Tasks** — task management with assignees and due dates
- **Analytics Dashboard** — KPI, operations, finance, and forecasting
- **File Uploads** — attach PDFs and images to invoices and orders
- **Authentication** — JWT-based user login with role-based access control
- **Tags** — flexible tagging across records
- **AI Features** — smart notes, task suggestions, query, quote drafting, document extraction
- **Responsive UI** — desktop and mobile layouts with bottom navigation

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Database**: MongoDB
- **Frontend**: Vanilla JS single-page app (no bundler)
- **Auth**: JWT tokens
- **File storage**: Local disk (`uploads/`)
- **Process manager**: PM2 or Docker Compose

## Modules

| Module | Description |
|---|---|
| Dashboard | Live pipeline snapshot, upcoming meetings widget, activity feed, workspace stats |
| Companies | Customer and prospect management |
| Contacts | Individual contact records linked to companies |
| Products | Product catalogue with pricing |
| Pricing | Price list management |
| Orders | Sales orders linked to shipping schedules and quotations |
| Quotations | Line-item quotes with PDF export |
| Invoices | Invoice tracking with payment status |
| Documents | File attachments with metadata |
| Shipping Schedules | Shipment milestone tracking with auto-advancing status |
| Samples | Sample shipment workflow |
| **Meetings** | Meeting planner — Calendar view, List view, Today & Upcoming view, reminders |
| Tasks | Work items with assignees and due dates |
| Notes | Free-form notes linked to any record |
| Analytics | KPI cards, revenue trends, forecasting, data quality |
| Settings | User management, site config, AI config, backup |

## Meeting Planner

The Meetings module provides full meeting lifecycle management:

- **Schedule meetings** from any Company record (auto-fills customer)
- **3 views**: Monthly Calendar, sortable List, Today & Upcoming cards
- **Status tracking**: Planned → Completed / Postponed / Cancelled
- **Reminders**: 30 minutes / 1 hour / 1 day before — shown as toast notifications
- **Follow-up tracking**: outcome notes, follow-up date, next action
- **Overdue follow-ups** surfaced in the Today view
- **Dashboard widget**: Upcoming meetings for today, tomorrow, and next 7 days

## Project Structure

```
SupplyFlow-CRM/
├── src/
│   ├── server.ts          # Main Express server and API routes
│   ├── mongodb.ts         # MongoDB connection and schema helpers
│   ├── db.ts              # Database utility types
│   ├── analytics.ts       # Analytics endpoints
│   └── types.ts           # Shared TypeScript types
├── public/
│   ├── index.html         # Main app shell and navigation
│   ├── app.js             # Frontend single-page app (~14k lines)
│   ├── styles.css         # Desktop + component styles
│   ├── mobile.css         # Mobile responsive styles
│   └── analytics/         # Analytics dashboard (React + ECharts)
├── scripts/
│   ├── init-admin.js              # Seed first admin user
│   ├── generate-password-hash.js  # Password hash utility
│   ├── migrate-to-mongodb.js      # Migration helper
│   ├── backup-mongodb.sh          # MongoDB backup script
│   ├── backup.ps1                 # Windows backup script
│   └── deploy-node.sh             # Node.js deploy script
├── dist/                  # Compiled JS output
├── uploads/               # Uploaded files (git-ignored)
├── Dockerfile
├── docker-compose.yml
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

## Environment Variables

Create a `.env` file based on `.env.example`:

```env
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

# Optional: AI features
ANTHROPIC_API_KEY=
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

## Running with PM2

```bash
npm run build
pm2 start dist/server.js --name SupplyFlow-CRM
pm2 save
```

## Docker

### Option 1 — Docker Compose (recommended)

Runs the app and MongoDB together with a single command.

1. **Copy and configure your environment file**:
   ```bash
   cp .env.example .env
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
   npm run build
   docker compose build app
   docker compose up -d app
   ```

> **Data persistence**: MongoDB data is stored in the `mongo_data` named volume. Uploaded files are stored in the `uploads` named volume. Both survive container restarts.

---

### Option 2 — Docker only (bring your own MongoDB)

```bash
docker build -t supplyflow-crm .

docker run -d \
  --name supplyflow-crm \
  -p 3000:3000 \
  -e MONGODB_URI=mongodb://your-mongo-host:27017 \
  -e MONGODB_DB_NAME=crmmango \
  -e AUTH_SECRET=your_secret \
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD=yourpassword \
  -v $(pwd)/uploads:/app/uploads \
  supplyflow-crm
```

## API Reference

All endpoints require `Authorization: Bearer <token>` and are scoped to the authenticated user.

### Core CRUD

```
GET    /api/:table          List records (supports ?limit=&offset=)
GET    /api/:table/:id      Get single record
POST   /api/:table          Create record
PUT    /api/:table/:id      Update record
DELETE /api/:table/:id      Delete record
POST   /api/:table/bulk     Bulk insert (CSV import)
GET    /api/:table/csv      Export as CSV
```

Supported tables: `companies`, `contacts`, `products`, `orders`, `quotations`, `invoices`, `documents`, `shipping_schedules`, `sample_shipments`, `tasks`, `notes`, `tags`, `meetings`

### Special Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/orders` | Orders enriched with live shipping status |
| `GET /api/meetings/upcoming` | Meetings for today + next 7 days |
| `GET /api/dashboard` | Pipeline snapshot, stats, activity feed |
| `GET /api/search?q=` | Global search across all collections |
| `POST /api/upload` | Upload file attachment |

### Analytics

| Endpoint | Description |
|---|---|
| `GET /api/kpis` | KPI cards, pipeline, invoice aging |
| `GET /api/timeseries` | Revenue / orders over time |
| `GET /api/breakdown` | Breakdown by company, product, status |
| `GET /api/forecast` | Revenue forecast with confidence band |
| `GET /api/data-quality` | Missing fields and data completeness |

### AI

| Endpoint | Description |
|---|---|
| `POST /api/ai/smart-note` | Generate structured note |
| `POST /api/ai/suggest-tasks` | Suggest follow-up tasks |
| `POST /api/ai/query` | Natural language data query |
| `POST /api/ai/draft-quote` | Draft a quotation |
| `POST /api/ai/extract-doc` | Extract data from a document |

## Shipping Status Flow

Status advances automatically based on milestone dates:

```
Pending → In Production → Booking Confirmed → Cargo Closing → Shipped → Arrived → Delivered
```

Status is computed from the shipping schedule's milestone dates and cascaded to linked orders at load time and on a scheduled hourly sync.

## Troubleshooting

### Login Issues

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "your@email.com", "password": "yourpassword"}'
```

### MongoDB Connection

```bash
mongosh mongodb://localhost:27017
```

### TypeScript Build Errors

```bash
npm run check   # type-check only
npm run build   # full compile
```

## License

MIT License
