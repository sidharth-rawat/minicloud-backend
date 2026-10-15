import {Router} from "express"
import { registerUserController,loginUserController,meUserController } from "./auth.controller.js"
import authenticateToken from "../../middleware/auth.middleware.js"
const route = Router()

route.post('/register',registerUserController)
route.post('/login',loginUserController)
route.get('/me',authenticateToken,meUserController)


export default route;