import {Router} from "express"
import { githubWebook } from "./webhook.controller.js"

const route = Router()

route.post('/github',githubWebook)

export default route