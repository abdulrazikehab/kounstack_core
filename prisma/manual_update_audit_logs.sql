-- Manual migration to align the existing audit_logs table with the current Prisma schema
-- Adds missing columns and relaxes userId nullability without dropping any data.

ALTER TABLE "audit_logs"
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "tenantId" TEXT,
  ADD COLUMN IF NOT EXISTS "resourceType" TEXT,
  ADD COLUMN IF NOT EXISTS "oldValues" TEXT,
  ADD COLUMN IF NOT EXISTS "newValues" TEXT,
  ADD COLUMN IF NOT EXISTS "metadata" TEXT;

-- Indexes to match Prisma schema (created with IF NOT EXISTS for safety)
CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_action_idx" ON "audit_logs"("tenantId", "action");
CREATE INDEX IF NOT EXISTS "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX IF NOT EXISTS "audit_logs_userId_idx" ON "audit_logs"("userId");

-- Foreign keys for tenantId and userId (added only if they don't already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_tenantId_fkey'
  ) THEN
    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_userId_fkey'
  ) THEN
    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;


