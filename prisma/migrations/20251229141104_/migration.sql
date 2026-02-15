-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "responseDays" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "customer_problem_email_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "subjectAr" TEXT,
    "body" TEXT NOT NULL,
    "bodyAr" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_problem_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "aiResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_problem_email_templates_tenantId_key" ON "customer_problem_email_templates"("tenantId");

-- CreateIndex
CREATE INDEX "customer_problem_email_templates_tenantId_idx" ON "customer_problem_email_templates"("tenantId");

-- AddForeignKey
ALTER TABLE "customer_problem_email_templates" ADD CONSTRAINT "customer_problem_email_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
