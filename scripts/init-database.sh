#!/bin/bash

# Database initialization script for CRM Cloudflare App
# Creates admin user if it doesn't exist

set -e

echo "🔧 Initializing database for CRM Cloudflare App..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler not found. Please install it: npm install -g wrangler"
    exit 1
fi

# Default values
EMAIL="mark.wu@taicounty.com.tw"
PASSWORD="1@Nissanka"
NAME="Admin"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --email)
            EMAIL="$2"
            shift 2
            ;;
        --password)
            PASSWORD="$2"
            shift 2
            ;;
        --name)
            NAME="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--email email] [--password password] [--name name]"
            exit 1
            ;;
    esac
done

echo "📧 Email: $EMAIL"
echo "👤 Name: $NAME"

# Generate password hash
echo "🔐 Generating password hash..."
HASH_INFO=$(node scripts/generate-password-hash.js "$PASSWORD" "$EMAIL" "$NAME" 2>/dev/null | grep -A 20 "SQL to create/update user")

if [ -z "$HASH_INFO" ]; then
    echo "❌ Failed to generate password hash. Make sure Node.js is installed."
    echo "   You can manually run: node scripts/generate-password-hash.js \"$PASSWORD\" \"$EMAIL\" \"$NAME\""
    exit 1
fi

# Extract the INSERT SQL from the output
INSERT_SQL=$(echo "$HASH_INFO" | grep -A 15 "INSERT OR REPLACE" | head -16)

if [ -z "$INSERT_SQL" ]; then
    echo "❌ Could not extract SQL from hash generator output."
    echo "   Manual SQL generation needed."
    exit 1
fi

echo "📊 Checking if user exists in database..."
CHECK_SQL="SELECT COUNT(*) as count FROM users WHERE email = '$EMAIL';"

# Try to check user count (might fail if database not initialized)
if npx wrangler d1 execute crm-cloudflare-app-db --command "$CHECK_SQL" 2>/dev/null; then
    echo "✅ Database connection successful."
else
    echo "⚠️  Database might not be initialized or connection failed."
    echo "   The schema will auto-initialize on first API call."
fi

echo ""
echo "🚀 To create/update the admin user, run this command:"
echo "npx wrangler d1 execute crm-cloudflare-app-db --command \\"
echo "\"$INSERT_SQL\""

echo ""
echo "📝 Or manually execute this SQL:"
echo "$INSERT_SQL"

echo ""
echo "🔑 After creating the user, you can login with:"
echo "   Email: $EMAIL"
echo "   Password: $PASSWORD"

echo ""
echo "💡 Alternative: The system will auto-create the first admin user if no users exist."
echo "   Make a POST request to /api/auth/login with the credentials above."