-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authProviderId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "birthdate" DATETIME,
    "heightCm" INTEGER,
    "weightKg" INTEGER,
    "guardianId" TEXT,
    "videoConsentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("authProviderId", "birthdate", "createdAt", "email", "guardianId", "heightCm", "id", "name", "role", "videoConsentAt", "weightKg") SELECT "authProviderId", "birthdate", "createdAt", "email", "guardianId", "heightCm", "id", "name", "role", "videoConsentAt", "weightKg" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_authProviderId_key" ON "User"("authProviderId");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
