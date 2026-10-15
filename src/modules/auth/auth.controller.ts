
import jwt from 'jsonwebtoken';
import { registerUserValidation,loginUserValidation } from './auth.validation.js';
import { registerUser,loginUser, findUserById } from "./auth.service.js";
import { ZodError } from 'zod';

export const registerUserController = async (req: any, res: any) => {
    try {
        const data = registerUserValidation.parse(req.body);
        const { firstName, lastName, email, password } = data;
        const result = await registerUser(firstName, lastName, email, password)

        return res.status(201).json(result)
    } catch (error: unknown) {
        if (error instanceof ZodError) {
            return res.status(400).json({
                message: "Validation failed", errors: error.issues
            });
        }
        if (error instanceof Error) {
            return res.status(400).json({ message: error.message })
        }
        return res.status(500).json({ message: "Something went wrong" });
    }
}

export const loginUserController = async(req: any, res: any)=>{
    try {
        const data = loginUserValidation.parse(req.body);
        const { email, password } = data;
        const result = await loginUser( email, password)
        let jwtSecretKey = process.env.JWT_SECRET_KEY;
        if (!jwtSecretKey) {
            throw new Error("JWT_SECRET_KEY is not configured");
        }
        const token = jwt.sign({user_id:result.id}, jwtSecretKey,{ expiresIn: '1h' });
        const response = { ...result, token }

        return res.status(201).json(response)
    }catch (error: unknown) {
        if (error instanceof ZodError) {
            return res.status(400).json({
                message: "Validation failed", errors: error.issues
            });
        }
        if (error instanceof Error) {
            return res.status(400).json({ message: error.message })
        }
        return res.status(500).json({ message: "Something went wrong" });
    }
}


export const meUserController = async(req: any, res: any)=>{
    try {
        console.log(req.user)
        const decode= await findUserById(req.user.user_id)

        return res.status(200).json(decode)
    }catch (error: unknown) {
        return res.status(500).json({ message: "Something went wrong" });
    }
}


