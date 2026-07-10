-- CreateTable
CREATE TABLE "DrillCompletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "drillId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DrillCompletion_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DrillCompletion_drillId_fkey" FOREIGN KEY ("drillId") REFERENCES "Drill" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DrillCompletion_playerId_date_idx" ON "DrillCompletion"("playerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DrillCompletion_playerId_drillId_date_key" ON "DrillCompletion"("playerId", "drillId", "date");
