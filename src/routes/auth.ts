import { Router } from "express";
import {
  findUserByEmail,
  verifyPassword,
  signToken,
  registerVendor,
} from "../services/auth.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { getVendorById } from "../services/vendor.js";

export const authRouter = Router();

authRouter.post("/register", (req, res) => {
  const { businessName, ownerName, email, password, phone } = req.body ?? {};
  if (!businessName?.trim() || !ownerName?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: "Business name, owner name, email and password are required" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  try {
    const { user, vendorId } = registerVendor({
      businessName: String(businessName),
      ownerName: String(ownerName),
      email: String(email),
      password: String(password),
      phone: phone ? String(phone) : undefined,
    });
    const vendor = getVendorById(vendorId)!;
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      vendor: { id: vendor.id, name: vendor.name, slug: vendor.slug, plan: vendor.plan, status: vendor.status },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

authRouter.post("/login", (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const user = findUserByEmail(String(email));
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const { password_hash: _, ...safeUser } = user;
  const token = signToken(safeUser);
  const vendor = user.vendorId ? getVendorById(user.vendorId) : null;

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    vendor: vendor
      ? { id: vendor.id, name: vendor.name, slug: vendor.slug, plan: vendor.plan, status: vendor.status }
      : null,
  });
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  const vendor = req.user?.vendorId ? getVendorById(req.user.vendorId) : null;
  res.json({
    user: req.user,
    vendor: vendor
      ? { id: vendor.id, name: vendor.name, slug: vendor.slug, plan: vendor.plan, status: vendor.status }
      : null,
  });
});
