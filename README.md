# CRM Cloudflare Application

A full-stack CRM application built with Cloudflare Workers (Node.js/TypeScript) and Python (FastAPI) with container support.

## Features

- **Dual Implementation**: Both Node.js (Cloudflare Workers) and Python (FastAPI) backends
- **Cloudflare Integration**: D1 database, R2 storage, and Workers
- **Container Support**: Docker container for Python backend
- **Frontend**: Modern web interface with HTML, CSS, and JavaScript
- **Authentication**: User login and session management
- **CRM Functionality**: Companies, contacts, quotations, and file management

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
   ```

2. **Deploy Node.js Worker**:
   ```bash
   npx wrangler deploy -c wrangler.toml
   ```

3. **Deploy Python Container**:
   ```bash
   # Build and push to Cloudflare registry
   npx wrangler containers build .
   npx wrangler containers push crm-python-app:latest
   npx wrangler deploy -c wrangler-container.toml
   ```

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

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request
