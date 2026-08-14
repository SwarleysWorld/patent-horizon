/*
  Warnings:

  - Made the column `useCode` on table `Patent` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Patent" ALTER COLUMN "useCode" SET NOT NULL,
ALTER COLUMN "useCode" SET DEFAULT '';
