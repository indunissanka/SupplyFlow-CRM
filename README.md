# CRM Cloudflare Application

A full-stack CRM application built with Cloudflare Workers (Node.js/TypeScript) and Python (FastAPI) with container support.

## Features

- **Dual Implementation**: Both Node.js (Cloudflare Workers) and Python (FastAPI) backends
- **Cloudflare Integration**: D1 database, R2 storage, and Workers
- **Container Support**: Docker container for Python backend
- **Frontend**: Modern web interface with HTML, CSS, and JavaScript
- **Authentication**: User login and session management
- **CRM Functionality**: Companies, contacts, quotations, and file management
- **Analytics Dashboard**: KPI, operations, finance, and forecasting analytics at `/analytics`

## Analytics Dashboard

The analytics UI lives in `public/analytics/` and is built with React + TypeScript + Tailwind (CDN) using ECharts. It reads the existing JWT from localStorage after you log in to the main CRM UI.

### Build Analytics UI

```bash
npm run build:analytics
```

This compiles `public/analytics/app.ts` into `public/analytics/dist/app.js`. The `dist/` bundle is ignored in git and rebuilt on deploy. Run this before `npm run dev` if you want the analytics page locally.

SQL query reference lives in `analytics_queries.sql`.

### Analytics API Endpoints

All analytics endpoints require authentication and are scoped by `owner_email` (must match the JWT subject).

1) **GET `/api/kpis`**
   - Query: `owner_email`, `start`, `end`, optional filters `company_id`, `currency`, `status`, `assignee`
   - Returns core KPI cards + quotation pipeline + invoice aging buckets

2) **GET `/api/timeseries`**
   - Query: `owner_email`, `metric=revenue|orders|invoices|quotations|samples|tasks|shipping`, `grain=day|week|month`, `start`, `end`
   - Returns array of `{ date, value }`

3) **GET `/api/breakdown`**
   - Query: `owner_email`, `entity=company|product_category|status|assignee`, `metric=revenue|count`, `start`, `end`
   - Optional: `source=orders|quotations|invoices|tasks|shipping_schedules|sample_shipments`, `field=status|courier|carrier`, `limit`, `requires_quotation=1`

4) **GET `/api/forecast`**
   - Query: `owner_email`, `metric=revenue|orders|invoices|quotations|tasks|shipping|open_invoices|overdue_invoices`, `grain=week|month`, `horizon`
   - Returns forecast series + confidence band + backtest MAPE

5) **GET `/api/data-quality`**
   - Query: `owner_email`
   - Returns missing fields, orphans, duplicate contacts, and freshness timestamps

## Project Structure

```
crm-cloudflare-app/
├── src/                    # Node.js/TypeScript Cloudflare Worker
│   ├── index.ts           # Main Worker entry point
│   └── index.test.ts      # Tests
├── python_app/            # Python FastAPI application
│   ├── main.py           # FastAPI application
│   └── __init__.py       # Python package marker
├── requirements.txt      # Python dependencies
├── public/                # Frontend static assets
│   ├── index.html        # Main application
│   ├── styles.css        # Desktop CSS styles
│   ├── mobile.css        # Mobile theme (light)
│   ├── mobile-dark.css   # Mobile theme (dark)
│   ├── app.js            # Frontend JavaScript
│   ├── theme-test.html   # Theme testing page
│   └── theme-test-dark.html # Dark theme testing page
├── screenshots/           # Application screenshots
├── Dockerfile            # Docker configuration for Python app
├── wrangler.toml         # Cloudflare Worker configuration
├── wrangler-container.toml # Container configuration
└── package.json          # Node.js dependencies
```

## Themes and Mobile Responsiveness

The application features a responsive design with multiple theme options:

### Desktop Theme
- **File**: `public/styles.css`
- **Description**: Default dark blue theme optimized for desktop viewing
- **Features**: Professional CRM interface with sidebar navigation, data tables, and forms

### Mobile Themes
Two mobile-optimized themes are available for viewports ≤ 900px:

1. **Mobile Light Theme** (`public/mobile.css`)
   - Color palette: Slate/blue with light backgrounds
   - Optimized for mobile touch interactions
   - Enhanced readability on mobile screens

2. **Mobile Dark Theme** (`public/mobile-dark.css`)
   - Color palette: Dark slate with violet accents
   - Modern dark theme for better viewing in low-light conditions
   - Improved contrast ratios and touch targets
   - Custom scrollbar styling

### Theme Implementation
- **Approach**: CSS variable overrides within `@media (max-width: 900px)` media queries
- **Benefits**: Desktop theme remains completely unchanged; mobile themes only apply on small screens
- **Testing**: Use `theme-test.html` and `theme-test-dark.html` to preview themes

### Key Mobile Features
- Touch-friendly buttons (44px minimum touch targets)
- Responsive grid layouts
- Optimized font sizes for mobile readability
- Mobile-specific form controls and navigation

## Deployment Status

### 1. Node.js Server (Cloudflare Workers)
- **URL**: `https://crmforall.indunissanka.workers.dev`
- **Status**: ✅ Deployed and running
- **Features**: Full CRM functionality with D1 database and R2 storage

### 2. Python Server (Container)
- **Container Image**: `crm-python-app-amd64:latest`
- **Registry**: Pushed to Cloudflare container registry
- **Status**: ✅ Built and ready for deployment

## Setup and Deployment

### Prerequisites
- Node.js 18+ and npm
- Python 3.11+
- Docker
- Cloudflare account with API token
- Git

### Local Development

1. **Node.js Server**:
   ```bash
   npm install
   npm run dev
   ```
   Server runs on `http://localhost:8787`

2. **Python Server**:
   ```bash
   pip install -r requirements.txt
   python python_app/main.py
   ```
   Server runs on `http://localhost:8080`

3. **Docker Container**:
   ```bash
   docker build -t crm-python-app .
   docker run -p 8080:8080 crm-python-app
   ```

### Cloudflare Deployment

1. **Configure environment variables** in `.env` file:
   ```
   CLOUDFLARE_ACCOUNT_ID=your_account_id
   D1_API_TOKEN=your_api_token
   D1_DATABASE_ID=your_database_id
   AUTH_SECRET=your_secure_random_string_for_jwt_tokens
   ```

2. **Deploy Node.js Worker**:
   ```bash
   # Standard deployment (requires AUTH_SECRET already set as secret)
   npx wrangler deploy -c wrangler.toml
   
   # Full deployment with automatic AUTH_SECRET secret setup
   npm run deploy:full
   ```

3. **Deploy Python Container**:
   ```bash
   # Build and push to Cloudflare registry
   npx wrangler containers build .
   npx wrangler containers push crm-python-app:latest
   npx wrangler deploy -c wrangler-container.toml
   ```

### Automatic Secret Management

The project includes an automated deployment script that automatically sets the `AUTH_SECRET` as a Cloudflare Workers secret during deployment:

```bash
npm run deploy:full
```

This script (`scripts/deploy.sh`):
1. Checks for `AUTH_SECRET` in `.env` file or environment variables
2. Sets it as a Cloudflare Workers secret using `wrangler secret put AUTH_SECRET`
3. Deploys the worker with all configurations

For CI/CD environments, ensure `AUTH_SECRET` is available as an environment variable.

## GitHub Repository Setup

This repository has been initialized locally. To upload to GitHub:

1. **Create a new repository on GitHub**:
   - Go to https://github.com/new
   - Repository name: `crm-cloudflare-app`
   - Description: "CRM application with Cloudflare Workers and Python container"
   - Choose public or private
   - Do NOT initialize with README, .gitignore, or license

2. **Connect and push**:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/crm-cloudflare-app.git
   git branch -M main
   git push -u origin main
   ```

3. **Set up GitHub Pages** (optional for documentation):
   - Go to repository Settings > Pages
   - Source: `main` branch, `/docs` folder (or root)
   - Save

## Environment Variables

Create a `.env` file with:
```
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
D1_DATABASE_ID=your_database_id
D1_API_TOKEN=your_api_token
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET=your_r2_bucket
AUTH_SECRET=your_secure_random_string_for_jwt_tokens
```

**Important**: The `AUTH_SECRET` must be a secure random string (at least 32 characters) for JWT token generation and verification. You can generate one with:
```bash
openssl rand -base64 32
```

## Troubleshooting

### Login Issues

If you encounter login problems (e.g., "Invalid credentials" error), follow these steps:

#### 1. Check Database Users
```bash
# List all users in the database
npx wrangler d1 execute crm-cloudflare-app-db --command "SELECT email, enabled FROM users;"
```

#### 2. Reset Admin Password
If the user `admin@salesaid.com` exists but login fails:

```bash
# Generate a new password hash
node scripts/generate-password-hash.js "your-new-password" "admin@salesaid.com"

# Update the user in the database (use the SQL output from above)
npx wrangler d1 execute crm-cloudflare-app-db --command "UPDATE users SET password_hash = 'pbkdf2\$120000\$...', password_salt = '...', updated_at = CURRENT_TIMESTAMP WHERE email = 'admin@salesaid.com';"
```

#### 3. Create New Admin User
If no users exist in the database:

```bash
# Run the database initialization script
./scripts/init-database.sh

# Or create a user manually using the generator script
node scripts/init-admin.js "your-email@example.com" "your-password"
```

#### 4. Verify Password Hash Format
The password hash must be in the format: `pbkdf2$120000$<64_character_hex_hash>`
- Check the hash in the database: `SELECT password_hash FROM users WHERE email = 'your-email@example.com';`
- The hash should start with `pbkdf2$120000$` followed by 64 hex characters
- If the hash is truncated or malformed, regenerate it using the generator script

#### 5. Test Login Locally
```bash
# Test login with curl
curl -X POST http://localhost:8787/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@salesaid.com", "password": "1@Nissanka"}'
```

### Deployment Issues

#### AUTH_SECRET Not Set
If you see "Authentication not configured" error:
```bash
# Ensure AUTH_SECRET is set as a Cloudflare Workers secret
npm run deploy:full
```

#### TypeScript Compilation Errors
If deployment fails due to TypeScript errors:
```bash
# Fix TypeScript errors locally first
npm run type-check

# Or build to see errors
npm run build
```

### Database Issues

#### Reset Local Database
```bash
# Delete local D1 database
rm -rf .wrangler/state/v3/d1

# Recreate database
npx wrangler d1 create crm-cloudflare-app-db
npx wrangler d1 execute crm-cloudflare-app-db --file=schema.sql
```

#### Check Database Schema
```bash
# List all tables
npx wrangler d1 execute crm-cloudflare-app-db --command "SELECT name FROM sqlite_master WHERE type='table';"
```

## Default Login Credentials

After initial deployment, you can use:
- **Email**: `admin@salesaid.com`
- **Password**: `1@Nissanka`

To change these credentials, use the password reset tools in the `scripts/` directory.

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request
