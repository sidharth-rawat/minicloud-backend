-- CreateIndex
CREATE INDEX "Deployment_projectId_idx" ON "Deployment"("projectId");

-- CreateIndex
CREATE INDEX "DeploymentLog_deploymentId_idx" ON "DeploymentLog"("deploymentId");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");
