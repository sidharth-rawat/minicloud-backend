import type { Request, Response, NextFunction } from 'express';
import jwt from "jsonwebtoken"
import type { AuthUser } from '../types/express.js';

const authenticateToken = (req:Request, res:Response, next:NextFunction) => {
  const authHeader = req.headers['authorization'];
  
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    let jwtSecretKey = process.env.JWT_SECRET_KEY;
        if (!jwtSecretKey) {
            throw new Error("JWT_SECRET_KEY is not configured");
        }
    const decoded = jwt.verify(token, jwtSecretKey) as AuthUser
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired token.' });
  }
};

export default authenticateToken;
