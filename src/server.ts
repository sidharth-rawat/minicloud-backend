import express from "express";
import { PORT } from "./config/env.js";
const app = express()


app.get('/health', (req, res) => {
    return res.status(200).json({ "status": "Ok" })
})

app.listen(PORT, () => {
    console.log("Server is running 3000")
})