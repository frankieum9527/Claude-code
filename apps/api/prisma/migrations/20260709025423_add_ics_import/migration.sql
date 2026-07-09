/*
  Warnings:

  - A unique constraint covering the columns `[seasonId,externalId]` on the table `ScheduleEvent` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ScheduleEvent" ADD COLUMN "title" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN "icsGamesUrl" TEXT;
ALTER TABLE "Team" ADD COLUMN "icsUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleEvent_seasonId_externalId_key" ON "ScheduleEvent"("seasonId", "externalId");
