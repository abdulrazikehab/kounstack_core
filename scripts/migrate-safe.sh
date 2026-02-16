#!/bin/bash

# Safe Prisma Migration Script - Preserves Data
# This script runs Prisma migrations without removing existing data

set -e  # Exit on error

SCHEMA_PATH="prisma/schema.prisma"
MIGRATION_NAME="${1:-migration}"

echo "🔄 Starting safe Prisma migration..."
echo "📋 Schema: $SCHEMA_PATH"
echo "📝 Migration name: $MIGRATION_NAME"
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable is not set"
    echo "   Please set it in your .env file or export it"
    exit 1
fi

echo "✅ Database URL is configured"
echo ""

# Option 1: Create migration without applying (safest for development)
echo "📦 Creating migration file (without applying)..."
npx prisma migrate dev --create-only --name "$MIGRATION_NAME" --schema="$SCHEMA_PATH"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration file created successfully!"
    echo ""
    echo "📋 Next steps:"
    echo "   1. Review the migration file in prisma/migrations/"
    echo "   2. If the migration looks correct, apply it with:"
    echo "      npx prisma migrate deploy --schema=$SCHEMA_PATH"
    echo ""
    echo "   Or to apply in development mode:"
    echo "      npx prisma migrate dev --schema=$SCHEMA_PATH"
else
    echo "❌ Failed to create migration"
    exit 1
fi

