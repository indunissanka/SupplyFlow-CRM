#!/bin/bash

# Deployment script for CRM Cloudflare App
# Sets AUTH_SECRET as Cloudflare Workers secret and deploys

set -e

echo "🚀 Starting deployment..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler not found. Please install it: npm install -g wrangler"
    exit 1
fi

# Load environment variables from .env if it exists
if [ -f .env ]; then
    echo "📄 Loading environment variables from .env"
    export $(grep -v '^#' .env | xargs)
fi

# Check if AUTH_SECRET is set
if [ -z "$AUTH_SECRET" ]; then
    echo "❌ AUTH_SECRET is not set. Please set it in .env or environment variables."
    exit 1
fi

echo "🔐 Setting AUTH_SECRET as Cloudflare Workers secret..."
echo "$AUTH_SECRET" | wrangler secret put AUTH_SECRET

echo "📦 Deploying Cloudflare Worker..."
wrangler deploy -c wrangler.toml

echo "✅ Deployment complete!"