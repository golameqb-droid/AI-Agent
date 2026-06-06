import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { webhookRouter } from "./routes/webhook.js";
import { apiRouter } from "./routes/api.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { billingRouter } from "./routes/billing.js";
import { metaRouter } from "./routes/meta.js";
import { startScheduler } from "./scheduler.js";
import { migrateAiToPlatform } from "./services/platform.js";
import { migratePaymentsToPlatform } from "./services/platform-payments.js";

migrateAiToPlatform();
migratePaymentsToPlatform();
fs.mkdirSync(config.paths.uploads, { recursive: true });

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => res.json({ ok: true, platform: config.platform.name }));

app.get("/app", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(config.paths.public, "app.html"));
});

app.get("/pricing", (_req, res) => {
  res.sendFile(path.join(config.paths.public, "pricing.html"));
});

app.use("/", webhookRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/billing", billingRouter);
app.use("/api/meta", metaRouter);
app.use("/api", apiRouter);
app.use("/uploads", express.static(config.paths.uploads));
app.use(
  "/",
  express.static(config.paths.public, {
    setHeaders(res, filePath) {
      if (/\.(js|css|html)$/.test(filePath)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    },
  })
);

app.listen(config.port, () => {
  logger.info("====================================================");
  logger.info(`  ${config.platform.name} is running`);
  logger.info(`  Landing:    http://localhost:${config.port}`);
  logger.info(`  Dashboard:  http://localhost:${config.port}/app`);
  logger.info(`  Pricing:    http://localhost:${config.port}/pricing`);
  logger.info(`  Webhook:    http://localhost:${config.port}/webhook`);
  logger.info("----------------------------------------------------");
  logger.info(`  Super admin: ${config.platform.superAdminEmail}`);
  logger.info("====================================================");
  startScheduler();
});
