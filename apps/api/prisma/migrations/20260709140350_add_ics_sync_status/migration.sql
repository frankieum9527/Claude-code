-- AlterTable
ALTER TABLE "Team" ADD COLUMN "icsLastSyncedAt" DATETIME;
ALTER TABLE "Team" ADD COLUMN "icsSyncError" TEXT;
ALTER TABLE "Team" ADD COLUMN "icsSyncStatus" TEXT;
