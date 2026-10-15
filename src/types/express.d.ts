import type { JwtPayload } from 'jsonwebtoken';

export interface AuthUser extends JwtPayload {
  user_id: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      // Raw request body captured by express.json({ verify }) so the GitHub
      // webhook route can verify the X-Hub-Signature-256 HMAC over exact bytes.
      rawBody?: Buffer;
    }
  }
}

export {};
