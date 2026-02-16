# Safe Prisma Migration Deploy Script - Production Safe (PowerShell)
# This script applies pending migrations without resetting the database

$ErrorActionPreference = "Stop"
$SchemaPath = "prisma/schema.prisma"

Write-Host "🚀 Deploying Prisma migrations safely (production mode)..." -ForegroundColor Cyan
Write-Host "📋 Schema: $SchemaPath" -ForegroundColor Gray
Write-Host "⚠️  This will apply pending migrations without resetting data" -ForegroundColor Yellow
Write-Host ""

# Check if DATABASE_URL is set
if (-not $env:DATABASE_URL) {
    Write-Host "❌ Error: DATABASE_URL environment variable is not set" -ForegroundColor Red
    Write-Host "   Please set it in your .env file or export it" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Database URL is configured" -ForegroundColor Green
Write-Host ""

# Generate Prisma Client first
Write-Host "🔨 Generating Prisma Client..." -ForegroundColor Cyan
npx prisma generate --schema="$SchemaPath"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to generate Prisma Client" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Prisma Client generated" -ForegroundColor Green
Write-Host ""

# Deploy migrations (production-safe, doesn't reset database)
Write-Host "📦 Applying pending migrations..." -ForegroundColor Cyan
npx prisma migrate deploy --schema="$SchemaPath"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ All migrations applied successfully!" -ForegroundColor Green
    Write-Host "💾 Your data has been preserved" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to apply migrations" -ForegroundColor Red
    exit 1
}

