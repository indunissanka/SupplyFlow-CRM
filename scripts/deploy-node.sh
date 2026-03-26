#!/bin/bash

# Deployment script for Node.js CRM App
# Sets up environment, builds, and starts the Node.js server

set -e

echo "?? Starting Node.js deployment..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "? Node.js not found. Please install Node.js 18+"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "? npm not found. Please install npm"
    exit 1
fi

# Load environment variables from .env if it exists
if [ -f .env ]; then
    echo "?? Loading environment variables from .env"
    export $(grep -v '^#' .env | xargs)
else
    echo "? .env file not found. Creating from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "? Created .env file. Please edit it with your configuration."
    else
        echo "? .env.example not found. Creating basic .env file..."
        cat > .env << EOF
# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=crmmango

# Server Configuration
PORT=3000
ALLOWED_ORIGINS=*

# Authentication
AUTH_SECRET=your-secret-key-here-change-in-production

# Optional: Shippo API for tracking
SHIPPO_API_KEY=

# Optional: AI Configuration
AI_MODEL=claude-haiku-4-5-20251001
EOF
        echo "? Created .env file. Please edit it with your configuration."
    fi
fi

# Check if MongoDB is running (optional check)
if [ -z "$MONGODB_URI" ]; then
    echo "? MONGODB_URI is not set. Please set it in .env"
    exit 1
fi

echo "?? Installing dependencies..."
npm install

echo "?? Building TypeScript..."
npm run build

echo "?? Starting Node.js server..."
echo "? Server will run on port ${PORT:-3000}"
echo "? MongoDB URI: $MONGODB_URI"
echo "? MongoDB Database: $MONGODB_DB_NAME"
echo ""
echo "?? To run in production with PM2:"
echo "   npm install -g pm2"
echo "   pm2 start dist/server.js --name crm-app"
echo ""
echo "?? To run in development:"
echo "   npm run dev"
echo ""
echo "?? IMPORTANT: Database Setup"
echo "====================================="
echo "1. Make sure MongoDB is running at $MONGODB_URI"
echo "2. Initialize MongoDB schema by running:"
echo "   npm run db:init"
echo "3. Create admin user by making a POST request to /api/auth/login with:"
echo "   {"
echo "     \"email\": \"admin@example.com\","
echo "     \"password\": \"yourpassword\","
echo "     \"name\": \"Admin\""
echo "   }"
echo ""
echo "? Deployment configuration complete!"