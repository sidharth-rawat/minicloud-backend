/*
  Warnings:

  - A unique constraint covering the columns `[repositoryUrl]` on the table `Project` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Project_repositoryUrl_key" ON "Project"("repositoryUrl");
