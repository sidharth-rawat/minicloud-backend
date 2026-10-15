import {Router} from "express"
import {
    createProjectController,
    getProjectController,
    getProjectIDController,
    updateProjectController,
    deleteProjectController
} from "./project.controller.js"
import authenticateToken from "../../middleware/auth.middleware.js"
import deploymentRoutes from "../deployment/deployment.routes.js"
const route = Router()

route.post('/',authenticateToken,createProjectController)
route.get('/',authenticateToken,getProjectController)
route.get('/:id',authenticateToken,getProjectIDController)
route.patch('/:id',authenticateToken,updateProjectController)
route.delete('/:id',authenticateToken,deleteProjectController)

// Deployments live under a project: /projects/:projectId/deployments
route.use('/:projectId/deployments', deploymentRoutes)


export default route;
