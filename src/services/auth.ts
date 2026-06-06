import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { config } from "../config.js";
import { slugify } from "./vendor.js";
import { startTrial } from "./subscription.js";

export type UserRole = "super_admin" | "vendor_owner" | "vendor_staff";

export interface AuthUser {
  id: number;
  vendorId: number | null;
  email: string;
  name: string;
  role: UserRole;
}

export interface JwtPayload {
  userId: number;
  vendorId: number | null;
  role: UserRole;
  email: string;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signToken(user: AuthUser): string {
  const payload: JwtPayload = {
    userId: user.id,
    vendorId: user.vendorId,
    role: user.role,
    email: user.email,
  };
  return jwt.sign(payload, config.platform.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, config.platform.jwtSecret) as JwtPayload;
  } catch {
    return null;
  }
}

export function findUserByEmail(email: string): (AuthUser & { password_hash: string }) | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as any;
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    email: row.email,
    name: row.name,
    role: row.role,
    password_hash: row.password_hash,
  };
}

export function findUserById(id: number): AuthUser | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

export function registerVendor(input: {
  businessName: string;
  ownerName: string;
  email: string;
  password: string;
  phone?: string;
}): { vendorId: number; user: AuthUser } {
  const email = input.email.toLowerCase().trim();
  if (findUserByEmail(email)) throw new Error("Email already registered");

  let slug = slugify(input.businessName);
  const slugTaken = db.prepare("SELECT id FROM vendors WHERE slug = ?").get(slug);
  if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`;

  const create = db.transaction(() => {
    const v = db
      .prepare(
        "INSERT INTO vendors (name, slug, email, phone, status, plan) VALUES (?, ?, ?, ?, 'trial', 'trial')"
      )
      .run(input.businessName.trim(), slug, email, input.phone?.trim() || null);
    const vendorId = Number(v.lastInsertRowid);

    const hash = hashPassword(input.password);
    const u = db
      .prepare(
        "INSERT INTO users (vendor_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, 'vendor_owner')"
      )
      .run(vendorId, email, hash, input.ownerName.trim());
    const userId = Number(u.lastInsertRowid);

    db.prepare("INSERT INTO vendor_knowledge (vendor_id, content) VALUES (?, ?)").run(
      vendorId,
      defaultKnowledge(input.businessName.trim())
    );

    return { vendorId, userId };
  });

  const { vendorId, userId } = create();
  startTrial(vendorId);
  const user = findUserById(userId)!;
  return { vendorId, user };
}

function defaultKnowledge(businessName: string): string {
  return `# ${businessName} — Knowledge Base

> Fill in your business details below. The AI reads this before every reply.

## About
- **Business:** ${businessName}
- **What we sell:** << FILL THIS >>
- **Website:** << FILL THIS >>

## Products & Prices
- << product 1 >> — << price >>
- << product 2 >> — << price >>

## Payment Methods
- bKash / Nagad / Rocket: << number >>
- Cash on delivery: << yes/no >>

## Important Links
- Order / shop: << link >>
- Facebook page: << link >>

## FAQ
**Q: How do I order?**
A: << FILL THIS >>

**Q: Delivery time?**
A: << FILL THIS >>
`;
}
