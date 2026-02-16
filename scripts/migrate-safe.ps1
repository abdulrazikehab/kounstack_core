# Safe Prisma Migration Script - Preserves Data (PowerShell)
# This script runs Prisma migrations without removing existing data

param(
    [string]$MigrationName = "migration"
)

$ErrorActionPreference = "Stop"
$SchemaPath = "prisma/schema.prisma"

Write-Host "🔄 Starting safe Prisma migration..." -ForegroundColor Cyan
Write-Host "📋 Schema: $SchemaPath" -ForegroundColor Gray
Write-Host "📝 Migration name: $MigrationName" -ForegroundColor Gray
Write-Host ""

# Check if DATABASE_URL is set
if (-not $env:DATABASE_URL) {
    Write-Host "❌ Error: DATABASE_URL environment variable is not set" -ForegroundColor Red
    Write-Host "   Please set it in your .env file or export it" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Database URL is configured" -ForegroundColor Green
Write-Host ""

# Create migration without applying (safest for development)
Write-Host "📦 Creating migration file (without applying)..." -ForegroundColor Cyan
npx prisma migrate dev --create-only --name "$MigrationName" --schema="$SchemaPath"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Migration file created successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Next steps:" -ForegroundColor Yellow
    Write-Host "   1. Review the migration file in prisma/migrations/" -ForegroundColor Gray
    Write-Host "   2. If the migration looks correct, apply it with:" -ForegroundColor Gray
    Write-Host "      npx prisma migrate deploy --schema=$SchemaPath" -ForegroundColor White
    Write-Host ""
    Write-Host "   Or to apply in development mode:" -ForegroundColor Gray
    Write-Host "      npx prisma migrate dev --schema=$SchemaPath" -ForegroundColor White
} else {
    Write-Host "❌ Failed to create migration" -ForegroundColor Red
    exit 1
}

