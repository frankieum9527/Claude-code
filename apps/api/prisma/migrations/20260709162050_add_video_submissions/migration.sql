-- AlterTable
ALTER TABLE "User" ADD COLUMN "videoConsentAt" DATETIME;

-- CreateTable
CREATE TABLE "VideoSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "drillId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_upload',
    "storageKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoSubmission_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VideoSubmission_drillId_fkey" FOREIGN KEY ("drillId") REFERENCES "Drill" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "authorId" TEXT,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Feedback_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "VideoSubmission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Feedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoSubmission_storageKey_key" ON "VideoSubmission"("storageKey");

-- CreateIndex
CREATE INDEX "VideoSubmission_playerId_createdAt_idx" ON "VideoSubmission"("playerId", "createdAt");
