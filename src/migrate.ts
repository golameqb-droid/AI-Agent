import type Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { logger } from "./logger.js";

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === col);
}

/** Create multi-tenant tables and migrate legacy single-vendor data. */
export function runMigrations(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS vendors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'trial',
  plan        TEXT NOT NULL DEFAULT 'trial',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id     INTEGER,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'vendor_owner',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE TABLE IF NOT EXISTS vendor_settings (
  vendor_id INTEGER NOT NULL,
  key       TEXT NOT NULL,
  value     TEXT,
  PRIMARY KEY (vendor_id, key),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE TABLE IF NOT EXISTS vendor_knowledge (
  vendor_id  INTEGER PRIMARY KEY,
  content    TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);
`);

  if (!hasColumn(db, "conversations", "vendor_id")) {
    logger.info("Migrating to multi-tenant schema…");
    migrateLegacyData(db);
  }

  seedSuperAdmin(db);
  runPhase2Migrations(db);
  runPhase3Migrations(db);
  runPhase4to6Migrations(db);
}

/** Phase 2: products catalog + human handoff on conversations. */
function runPhase2Migrations(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id   INTEGER NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  price       TEXT,
  image_url   TEXT,
  link        TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);
CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id);
`);

  if (!hasColumn(db, "conversations", "handoff_status")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN handoff_status TEXT NOT NULL DEFAULT 'ai'`);
    db.exec(`ALTER TABLE conversations ADD COLUMN handoff_at TEXT`);
    logger.info("Phase 2: added handoff fields to conversations");
  }

  if (!hasColumn(db, "messages", "image_url")) {
    db.exec(`ALTER TABLE messages ADD COLUMN image_url TEXT`);
    logger.info("Phase 2: added image_url to messages");
  }
}

/** Phase 3: order system for Messenger sales. */
function runPhase3Migrations(db: Database.Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id        INTEGER NOT NULL,
  conversation_id  INTEGER,
  order_number     TEXT NOT NULL,
  customer_name    TEXT,
  customer_phone   TEXT,
  customer_address TEXT,
  items_json       TEXT NOT NULL DEFAULT '[]',
  total            TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  source           TEXT NOT NULL DEFAULT 'ai',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
CREATE INDEX IF NOT EXISTS idx_orders_vendor ON orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(vendor_id, status);
`);
}

/** Phases 4–6: omnichannel, subscriptions, payments, advanced posts. */
function runPhase4to6Migrations(db: Database.Database): void {
  if (!hasColumn(db, "conversations", "channel")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN channel TEXT NOT NULL DEFAULT 'messenger'`);
    logger.info("Phase 5: added channel to conversations");
  }

  db.exec(`
CREATE TABLE IF NOT EXISTS subscriptions (
  vendor_id       INTEGER PRIMARY KEY,
  plan            TEXT NOT NULL DEFAULT 'trial',
  status          TEXT NOT NULL DEFAULT 'active',
  messages_limit  INTEGER NOT NULL DEFAULT 500,
  period_start    TEXT NOT NULL DEFAULT (datetime('now')),
  period_end      TEXT NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE TABLE IF NOT EXISTS usage_monthly (
  vendor_id     INTEGER NOT NULL,
  month         TEXT NOT NULL,
  messages_in   INTEGER NOT NULL DEFAULT 0,
  messages_out  INTEGER NOT NULL DEFAULT 0,
  ai_replies    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (vendor_id, month),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id       INTEGER NOT NULL,
  plan            TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'BDT',
  gateway         TEXT NOT NULL,
  transaction_id  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  metadata        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE TABLE IF NOT EXISTS post_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id   INTEGER NOT NULL,
  name        TEXT NOT NULL,
  message     TEXT NOT NULL,
  image_url   TEXT,
  link        TEXT,
  tags        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);
CREATE INDEX IF NOT EXISTS idx_post_templates_vendor ON post_templates(vendor_id);
`);

  if (!hasColumn(db, "posts", "title")) {
    db.exec(`ALTER TABLE posts ADD COLUMN title TEXT`);
    db.exec(`ALTER TABLE posts ADD COLUMN tags TEXT`);
    db.exec(`ALTER TABLE posts ADD COLUMN category TEXT DEFAULT 'general'`);
    logger.info("Phase 4: added title/tags/category to posts");
  }

  migrateConversationsChannelUnique(db);
  migrateAiTokenTracking(db);

  // Backfill trials for existing vendors
  const vendors = db.prepare("SELECT id FROM vendors").all() as { id: number }[];
  for (const v of vendors) {
    const sub = db.prepare("SELECT vendor_id FROM subscriptions WHERE vendor_id = ?").get(v.id);
    if (!sub) {
      const end = new Date();
      end.setDate(end.getDate() + 14);
      db.prepare(
        `INSERT INTO subscriptions (vendor_id, plan, status, messages_limit, period_start, period_end)
         VALUES (?, 'trial', 'active', 500, datetime('now'), ?)`
      ).run(v.id, end.toISOString());
    }
  }
}

function migrateLegacyData(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");

  // Rebuild conversations with vendor_id + composite unique (vendor_id, psid)
  db.exec(`
    ALTER TABLE conversations RENAME TO conversations_old;
    CREATE TABLE conversations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id     INTEGER NOT NULL,
      psid          TEXT NOT NULL,
      customer_name TEXT,
      last_message  TEXT,
      unread        INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(vendor_id, psid),
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    );
    ALTER TABLE comments ADD COLUMN vendor_id INTEGER;
    ALTER TABLE posts ADD COLUMN vendor_id INTEGER;
  `);

  const vendorId = ensureDefaultVendor(db);
  importLegacySettings(db, vendorId);

  db.exec(`
    INSERT INTO conversations (id, vendor_id, psid, customer_name, last_message, unread, created_at, updated_at)
    SELECT id, ${vendorId}, psid, customer_name, last_message, unread, created_at, updated_at FROM conversations_old;
    DROP TABLE conversations_old;
    UPDATE comments SET vendor_id = ${vendorId} WHERE vendor_id IS NULL;
    UPDATE posts SET vendor_id = ${vendorId} WHERE vendor_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_conversations_vendor ON conversations(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_comments_vendor ON comments(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_posts_vendor ON posts(vendor_id);
  `);

  db.pragma("foreign_keys = ON");
  logger.info(`Legacy data assigned to default vendor #${vendorId}`);
}

function migrateAiTokenTracking(db: Database.Database): void {
  if (!hasColumn(db, "usage_monthly", "ai_tokens_in")) {
    db.exec(`ALTER TABLE usage_monthly ADD COLUMN ai_tokens_in INTEGER NOT NULL DEFAULT 0`);
    db.exec(`ALTER TABLE usage_monthly ADD COLUMN ai_tokens_out INTEGER NOT NULL DEFAULT 0`);
    db.exec(`ALTER TABLE usage_monthly ADD COLUMN ai_cost_usd REAL NOT NULL DEFAULT 0`);
    logger.info("Added AI token/cost columns to usage_monthly");
  }
  db.exec(`
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id   INTEGER NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL NOT NULL DEFAULT 0,
  purpose     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_vendor ON ai_usage_log(vendor_id, created_at);
`);
}

/** Fix UNIQUE(vendor_id, psid) → UNIQUE(vendor_id, channel, psid) for omnichannel. */
function migrateConversationsChannelUnique(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversations'")
    .get() as { sql: string } | undefined;
  if (!row?.sql) return;
  if (row.sql.includes("UNIQUE(vendor_id, channel, psid)")) {
    db.exec(`DROP TABLE IF EXISTS conversations_old`);
    return;
  }

  logger.info("Migrating conversations unique key to (vendor_id, channel, psid)…");
  db.pragma("foreign_keys = OFF");
  db.exec(`DROP TABLE IF EXISTS conversations_old`);
  db.exec(`
    ALTER TABLE conversations RENAME TO conversations_old;
    CREATE TABLE conversations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id     INTEGER NOT NULL,
      channel       TEXT NOT NULL DEFAULT 'messenger',
      psid          TEXT NOT NULL,
      customer_name TEXT,
      last_message  TEXT,
      unread        INTEGER NOT NULL DEFAULT 0,
      handoff_status TEXT NOT NULL DEFAULT 'ai',
      handoff_at    TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(vendor_id, channel, psid),
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    );
    INSERT INTO conversations (id, vendor_id, channel, psid, customer_name, last_message, unread, handoff_status, handoff_at, created_at, updated_at)
    SELECT id, vendor_id, channel, psid, customer_name, last_message, unread,
           COALESCE(handoff_status, 'ai'), handoff_at, created_at, updated_at
    FROM conversations_old;
    DROP TABLE conversations_old;
    CREATE INDEX IF NOT EXISTS idx_conversations_vendor ON conversations(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(vendor_id, channel);
  `);
  db.pragma("foreign_keys = ON");
}

function ensureDefaultVendor(db: Database.Database): number {
  const existing = db.prepare("SELECT id FROM vendors WHERE slug = 'default'").get() as
    | { id: number }
    | undefined;
  if (existing) return existing.id;

  const info = db
    .prepare(
      "INSERT INTO vendors (name, slug, email, status, plan) VALUES (?, ?, ?, ?, ?)"
    )
    .run("Default Vendor", "default", "default@socialai.pro", "active", "trial");
  const vendorId = Number(info.lastInsertRowid);

  db.prepare("INSERT INTO vendor_knowledge (vendor_id, content) VALUES (?, ?)").run(
    vendorId,
    "# Your Business Knowledge\n\nEdit this with your products, prices, links, and FAQ."
  );

  return vendorId;
}

function importLegacySettings(db: Database.Database, vendorId: number): void {
  const upsert = db.prepare(
    `INSERT INTO vendor_settings (vendor_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(vendor_id, key) DO UPDATE SET value = excluded.value`
  );

  const legacy = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  for (const row of legacy) upsert.run(vendorId, row.key, row.value);

  // Also import from environment / .env keys
  const envKeys = [
    "AI_PROVIDER",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "FB_PAGE_ID",
    "FB_PAGE_ACCESS_TOKEN",
    "FB_VERIFY_TOKEN",
    "FB_GRAPH_VERSION",
    "AUTO_REPLY_MESSAGES",
    "AUTO_REPLY_COMMENTS",
    "REPLY_LANGUAGE",
  ];
  for (const key of envKeys) {
    const val = process.env[key];
    if (val) upsert.run(vendorId, key, val);
  }
}

function seedSuperAdmin(db: Database.Database): void {
  const email = config.platform.superAdminEmail;
  const pass = config.platform.superAdminPassword;
  if (!email || !pass) return;

  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) return;

  const hash = bcrypt.hashSync(pass, 10);
  db.prepare(
    "INSERT INTO users (vendor_id, email, password_hash, name, role) VALUES (NULL, ?, ?, ?, 'super_admin')"
  ).run(email, hash, "Platform Admin");
  logger.info(`Super admin seeded: ${email}`);
}
