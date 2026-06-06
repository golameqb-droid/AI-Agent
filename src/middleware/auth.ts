import type { Request, Response, NextFunction } from "express";
import { verifyToken, findUserById, type AuthUser } from "../services/auth.js";

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired token" });

  const user = findUserById(payload.userId);
  if (!user) return res.status(401).json({ error: "User not found" });

  req.user = user;
  next();
}

export function requireVendor(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user?.vendorId) {
    return res.status(403).json({ error: "Vendor access required" });
  }
  next();
}

export function requireSuperAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "super_admin") {
    return res.status(403).json({ error: "Super admin access required" });
  }
  next();
}
