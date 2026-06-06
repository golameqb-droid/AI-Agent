import multer from "multer";
import path from "node:path";
import { vendorUploadsDir } from "../services/products.js";

const ALLOWED = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export const productImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const vid = Number(req.params.id);
      cb(null, vendorUploadsDir(vid));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `product-${Date.now()}${ALLOWED.has(ext) ? ext : ".jpg"}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ALLOWED.has(ext));
  },
});
