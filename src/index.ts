import express from "express";
import { config, aiConfigured, facebookConfigured } from "./config.js";
import { logger } from "./logger.js";
import { getSetting } from "./db.js";
import { webhookRouter } from "./routes/webhook.js";
import { apiRouter } from "./routes/api.js";
import { startScheduler } from "./scheduler.js";

// Apply persisted runtime overrides (set from the dashboard) on startup.
const overrideMsg = getSetting("autoReplyMessages");
const overrideCmt = getSetting("autoReplyComments");
const overrideLang = getSetting("replyLanguage");
if (overrideMsg !== null) config.behaviour.autoReplyMessages = overrideMsg === "true";
if (overrideCmt !== null) config.behaviour.autoReplyComments = overrideCmt === "true";
if (overrideLang) config.behaviour.replyLanguage = overrideLang;

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Facebook webhook (no auth — Facebook calls this)
app.use("/", webhookRouter);

// Dashboard API (basic-auth protected)
app.use("/api", apiRouter);

// Dashboard static files
app.use("/", express.static(config.paths.public));

app.listen(config.port, () => {
  logger.info("====================================================");
  logger.info("  eQuestionBankBD AI Agent is running");
  logger.info(`  Dashboard:  http://localhost:${config.port}`);
  logger.info(`  Webhook:    http://localhost:${config.port}/webhook`);
  logger.info("----------------------------------------------------");
  logger.info(`  AI provider:     ${config.ai.provider} ${aiConfigured() ? "(ready)" : "(NOT configured)"}`);
  logger.info(`  Facebook:        ${facebookConfigured() ? "connected" : "NOT configured"}`);
  logger.info(`  Auto-reply msg:  ${config.behaviour.autoReplyMessages}`);
  logger.info(`  Auto-reply cmt:  ${config.behaviour.autoReplyComments}`);
  logger.info(`  Reply language:  ${config.behaviour.replyLanguage}`);
  logger.info("====================================================");
  if (!aiConfigured())
    logger.warn("Add your free AI API key to .env to enable replies (see SETUP_FACEBOOK.md).");
  startScheduler();
});
