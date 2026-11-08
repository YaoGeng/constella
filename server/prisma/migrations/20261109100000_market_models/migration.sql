-- CreateEnum
CREATE TYPE "StatType" AS ENUM ('DOWNLOAD', 'INSTALL');
-- CreateEnum
CREATE TYPE "PackageKind" AS ENUM ('NODE', 'PACK', 'FLOW');
-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'OFFLINE');
-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('APPROVE', 'REJECT', 'OFFLINE');
-- CreateTable
CREATE TABLE "DownloadStat" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "StatType" NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DownloadStat_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "PackageVersion" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "semver" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackageVersion_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "kind" "PackageKind" NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'PENDING',
    "perms" TEXT[],
    "latestVersionId" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "starCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ReviewRecord" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewRecord_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "DownloadStat_packageId_ts_idx" ON "DownloadStat"("packageId", "ts");
-- CreateIndex
CREATE UNIQUE INDEX "PackageVersion_packageId_semver_key" ON "PackageVersion"("packageId", "semver");
-- CreateIndex
CREATE INDEX "Package_status_kind_updatedAt_idx" ON "Package"("status", "kind", "updatedAt");
-- AddForeignKey
ALTER TABLE "PackageVersion" ADD CONSTRAINT "PackageVersion_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_latestVersionId_fkey" FOREIGN KEY ("latestVersionId") REFERENCES "PackageVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
