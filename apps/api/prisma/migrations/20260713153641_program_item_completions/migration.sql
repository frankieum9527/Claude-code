-- CreateTable
CREATE TABLE "ProgramItemCompletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "itemIndex" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgramItemCompletion_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProgramItemCompletion_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProgramItemCompletion_playerId_date_idx" ON "ProgramItemCompletion"("playerId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramItemCompletion_playerId_programId_date_itemIndex_key" ON "ProgramItemCompletion"("playerId", "programId", "date", "itemIndex");
