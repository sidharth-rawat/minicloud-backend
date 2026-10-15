import { Router } from "express";
import {
    createDeploymentController,
    getDeploymentsController,
    getDeploymentByIdController,
    getDeploymentLogsController,
    retryDeploymentController,
    rollbackDeploymentController
} from "./deployment.controller.js";
import authenticateToken from "../../middleware/auth.middleware.js";

// mergeParams lets this router read :projectId from the parent project router.
const route = Router({ mergeParams: true });

route.post('/', authenticateToken, createDeploymentController);
route.get('/', authenticateToken, getDeploymentsController);
route.get('/:deploymentId', authenticateToken, getDeploymentByIdController);
route.get('/:deploymentId/logs', authenticateToken, getDeploymentLogsController);
route.post('/:deploymentId/retry', authenticateToken, retryDeploymentController);
route.post('/:deploymentId/rollback', authenticateToken, rollbackDeploymentController);

export default route;
