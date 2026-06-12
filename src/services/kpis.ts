import { db } from "../db.js";
import { getMonthlyUsage, canUseAi } from "./usage.js";
import { getSubscription } from "./subscription.js";
import { getPlan } from "./plans.js";
import { countHandoffQueue } from "./handoff.js";
import { countPendingOrders } from "./orders.js";
import { getVendorConfig } from "./vendor.js";
import { channelConfigured } from "./channels.js";
import { getPlatformAiConfig } from "./platform.js";
import { getTokenUsage, getPlatformTokenUsage, getDailyAiUsage } from "./ai-usage.js";
import {
  countCustomers,
  countNewCustomers7d,
  countCustomersWithOrders,
} from "./customers.js";
import { getPipelineSummary, countDealsConverted } from "./deals.js";
import { countFollowUpsSent } from "./follow-up.js";
import {
  countAbandonedCarts,
  countRecoveredCarts,
  recoveredRevenueEstimate,
} from "./cart-intents.js";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function one(sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { c: number }).c;
}

function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function channelCounts(vendorId?: number): Record<string, number> {
  const rows = vendorId
    ? (db
        .prepare(
          "SELECT channel, COUNT(*) c FROM conversations WHERE vendor_id = ? GROUP BY channel"
        )
        .all(vendorId) as { channel: string; c: number }[])
    : (db
        .prepare("SELECT channel, COUNT(*) c FROM conversations GROUP BY channel")
        .all() as { channel: string; c: number }[]);
  const out: Record<string, number> = { messenger: 0, whatsapp: 0, instagram: 0 };
  for (const r of rows) out[r.channel ?? "messenger"] = r.c;
  return out;
}

function getDailyMessageCounts(vendorId: number | null, days = 7) {
  const sql = vendorId
    ? `SELECT date(m.created_at) d,
              SUM(CASE WHEN m.direction='in' THEN 1 ELSE 0 END) messages_in,
              SUM(CASE WHEN m.direction='out' THEN 1 ELSE 0 END) messages_out
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.vendor_id = ? AND m.created_at >= datetime('now', ?)
       GROUP BY date(m.created_at) ORDER BY d`
    : `SELECT date(m.created_at) d,
              SUM(CASE WHEN m.direction='in' THEN 1 ELSE 0 END) messages_in,
              SUM(CASE WHEN m.direction='out' THEN 1 ELSE 0 END) messages_out
       FROM messages m
       WHERE m.created_at >= datetime('now', ?)
       GROUP BY date(m.created_at) ORDER BY d`;
  const offset = `-${days} days`;
  const rows = vendorId
    ? (db.prepare(sql).all(vendorId, offset) as { d: string; messages_in: number; messages_out: number }[])
    : (db.prepare(sql).all(offset) as { d: string; messages_in: number; messages_out: number }[]);
  return rows.map((r) => ({
    date: r.d,
    messagesIn: r.messages_in,
    messagesOut: r.messages_out,
  }));
}

function orderStatusCounts(vendorId?: number): Record<string, number> {
  const rows = vendorId
    ? (db
        .prepare("SELECT status, COUNT(*) c FROM orders WHERE vendor_id = ? GROUP BY status")
        .all(vendorId) as { status: string; c: number }[])
    : (db
        .prepare("SELECT status, COUNT(*) c FROM orders GROUP BY status")
        .all() as { status: string; c: number }[]);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.c;
  return out;
}

export function getVendorKpis(vendorId: number) {
  const month = currentMonth();
  const prev = previousMonth(month);
  const usage = getMonthlyUsage(vendorId);
  const prevUsage = db
    .prepare("SELECT * FROM usage_monthly WHERE vendor_id = ? AND month = ?")
    .get(vendorId, prev) as
    | { messages_in: number; messages_out: number; ai_replies: number }
    | undefined;
  const quota = canUseAi(vendorId);
  const sub = getSubscription(vendorId);
  const plan = getPlan(sub?.plan ?? "trial");
  const byChannel = channelCounts(vendorId);
  const orders = orderStatusCounts(vendorId);
  const totalOrders = Object.values(orders).reduce((s, n) => s + n, 0);
  const messagesIn = usage?.messages_in ?? 0;
  const aiReplies = usage?.ai_replies ?? 0;
  const tokens = getTokenUsage(vendorId, month);
  const cfg = getVendorConfig(vendorId);

  return {
    month,
    engagement: {
      totalConversations: one("SELECT COUNT(*) c FROM conversations WHERE vendor_id = ?", vendorId),
      newConversations7d: one(
        "SELECT COUNT(*) c FROM conversations WHERE vendor_id = ? AND created_at >= datetime('now', '-7 days')",
        vendorId
      ),
      activeConversations7d: one(
        "SELECT COUNT(*) c FROM conversations WHERE vendor_id = ? AND updated_at >= datetime('now', '-7 days')",
        vendorId
      ),
      messagesIn,
      messagesOut: usage?.messages_out ?? 0,
      byChannel,
    },
    support: {
      pendingInbox: one(
        `SELECT COUNT(*) c FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.vendor_id = ? AND m.status = 'pending'`,
        vendorId
      ),
      handoffQueue: countHandoffQueue(vendorId),
      handoffActive: one(
        "SELECT COUNT(*) c FROM conversations WHERE vendor_id = ? AND handoff_status = 'human_active'",
        vendorId
      ),
      pendingComments: one(
        "SELECT COUNT(*) c FROM comments WHERE vendor_id = ? AND status = 'pending'",
        vendorId
      ),
    },
    sales: {
      totalOrders,
      ordersThisMonth: one(
        "SELECT COUNT(*) c FROM orders WHERE vendor_id = ? AND created_at >= date('now', 'start of month')",
        vendorId
      ),
      pendingOrders: orders.pending ?? countPendingOrders(vendorId),
      confirmedOrders: orders.confirmed ?? 0,
      deliveredOrders: orders.delivered ?? 0,
      productsActive: one(
        "SELECT COUNT(*) c FROM products WHERE vendor_id = ? AND active = 1",
        vendorId
      ),
    },
    crm: {
      totalCustomers: countCustomers(vendorId),
      newCustomers7d: countNewCustomers7d(vendorId),
      customersWithOrders: countCustomersWithOrders(vendorId),
      pipeline: getPipelineSummary(vendorId),
      dealsWon: countDealsConverted(vendorId),
      followUpsSent30d: countFollowUpsSent(vendorId, 30),
      abandonedCarts: countAbandonedCarts(vendorId),
      recoveredCarts: countRecoveredCarts(vendorId),
      recoveredRevenue: recoveredRevenueEstimate(vendorId),
      followUpPending: one(
        "SELECT COUNT(*) c FROM follow_up_queue WHERE vendor_id = ? AND status = 'pending'",
        vendorId
      ),
    },
    ai: {
      provider: getPlatformAiConfig().aiProvider,
      aiReplies,
      tokensIn: tokens.tokensIn,
      tokensOut: tokens.tokensOut,
      costUsd: tokens.costUsd,
      avgTokensPerReply: aiReplies > 0 ? Math.round((tokens.tokensIn + tokens.tokensOut) / aiReplies) : 0,
      quotaLimit: quota.limit,
      quotaUsedPct:
        quota.limit > 0 ? Math.min(100, Math.round((aiReplies / quota.limit) * 100)) : 0,
      automationRate: messagesIn > 0 ? Math.min(100, Math.round((aiReplies / messagesIn) * 100)) : 0,
      planName: plan.name,
    },
    channels: {
      messenger: channelConfigured(cfg, "messenger"),
      whatsapp: channelConfigured(cfg, "whatsapp"),
      instagram: channelConfigured(cfg, "instagram"),
    },
    dailyAi: getDailyAiUsage(vendorId, 7),
    dailyEngagement: getDailyMessageCounts(vendorId, 7),
    content: {
      publishedPosts: one(
        "SELECT COUNT(*) c FROM posts WHERE vendor_id = ? AND status = 'published'",
        vendorId
      ),
      scheduledPosts: one(
        "SELECT COUNT(*) c FROM posts WHERE vendor_id = ? AND status = 'scheduled'",
        vendorId
      ),
      commentsReplied: one(
        "SELECT COUNT(*) c FROM comments WHERE vendor_id = ? AND status = 'sent'",
        vendorId
      ),
      drafts: one("SELECT COUNT(*) c FROM posts WHERE vendor_id = ? AND status = 'draft'", vendorId),
    },
    trends: {
      aiRepliesDeltaPct: deltaPct(aiReplies, prevUsage?.ai_replies ?? 0),
      messagesInDeltaPct: deltaPct(messagesIn, prevUsage?.messages_in ?? 0),
      messagesOutDeltaPct: deltaPct(usage?.messages_out ?? 0, prevUsage?.messages_out ?? 0),
    },
  };
}

export function getPlatformKpis() {
  const month = currentMonth();
  const prev = previousMonth(month);
  const aiThis = one(
    "SELECT COALESCE(SUM(ai_replies), 0) c FROM usage_monthly WHERE month = ?",
    month
  );
  const aiLast = one(
    "SELECT COALESCE(SUM(ai_replies), 0) c FROM usage_monthly WHERE month = ?",
    prev
  );
  const inThis = one(
    "SELECT COALESCE(SUM(messages_in), 0) c FROM usage_monthly WHERE month = ?",
    month
  );
  const outThis = one(
    "SELECT COALESCE(SUM(messages_out), 0) c FROM usage_monthly WHERE month = ?",
    month
  );
  const vendors = db.prepare("SELECT id, plan, status FROM vendors").all() as {
    id: number;
    plan: string;
    status: string;
  }[];
  const byPlan: Record<string, number> = { trial: 0, pro: 0, elite: 0, enterprise: 0 };
  let messengerConnected = 0;
  let whatsappConnected = 0;
  let instagramConnected = 0;
  for (const v of vendors) {
    byPlan[v.plan] = (byPlan[v.plan] ?? 0) + 1;
    const cfg = getVendorConfig(v.id);
    if (channelConfigured(cfg, "messenger")) messengerConnected++;
    if (channelConfigured(cfg, "whatsapp")) whatsappConnected++;
    if (channelConfigured(cfg, "instagram")) instagramConnected++;
  }
  const totalV = vendors.length || 1;
  const orders = orderStatusCounts();
  const revenueBdt = one(
    `SELECT COALESCE(SUM(amount), 0) c FROM payments
     WHERE status = 'completed' AND created_at >= date('now', 'start of month')`
  );
  const mrrEstimate =
    (byPlan.pro ?? 0) * (getPlan("pro").priceBdt ?? 0) +
    (byPlan.elite ?? 0) * (getPlan("elite").priceBdt ?? 0);
  const platformTokens = getPlatformTokenUsage(month);

  return {
    month,
    business: {
      totalVendors: vendors.length,
      activeVendors: one("SELECT COUNT(*) c FROM vendors WHERE status = 'active'"),
      trialVendors: one("SELECT COUNT(*) c FROM vendors WHERE status = 'trial'"),
      suspendedVendors: one("SELECT COUNT(*) c FROM vendors WHERE status = 'suspended'"),
      newVendorsThisMonth: one(
        "SELECT COUNT(*) c FROM vendors WHERE created_at >= date('now', 'start of month')"
      ),
      byPlan,
      channelAdoption: {
        messenger: { connected: messengerConnected, pct: Math.round((messengerConnected / totalV) * 100) },
        whatsapp: { connected: whatsappConnected, pct: Math.round((whatsappConnected / totalV) * 100) },
        instagram: { connected: instagramConnected, pct: Math.round((instagramConnected / totalV) * 100) },
      },
    },
    usage: {
      aiRepliesThisMonth: aiThis,
      messagesInThisMonth: inThis,
      messagesOutThisMonth: outThis,
      aiRepliesDeltaPct: deltaPct(aiThis, aiLast),
      tokensInThisMonth: platformTokens.tokensIn,
      tokensOutThisMonth: platformTokens.tokensOut,
      aiCostUsdThisMonth: platformTokens.costUsd,
      avgTokensPerReply: aiThis > 0 ? Math.round((platformTokens.tokensIn + platformTokens.tokensOut) / aiThis) : 0,
      conversationsByChannel: channelCounts(),
      totalConversations: one("SELECT COUNT(*) c FROM conversations"),
      totalMessages: one("SELECT COUNT(*) c FROM messages"),
      dailyAi: getDailyAiUsage(null, 7),
      dailyEngagement: getDailyMessageCounts(null, 7),
    },
    revenue: {
      completedPaymentsThisMonth: one(
        `SELECT COUNT(*) c FROM payments
         WHERE status = 'completed' AND created_at >= date('now', 'start of month')`
      ),
      revenueBdtThisMonth: revenueBdt,
      pendingPayments: one("SELECT COUNT(*) c FROM payments WHERE status = 'pending'"),
      mrrEstimate,
    },
    operations: {
      totalOrders: Object.values(orders).reduce((s, n) => s + n, 0),
      pendingOrders: orders.pending ?? 0,
      handoffQueue: one(
        "SELECT COUNT(*) c FROM conversations WHERE handoff_status = 'human_requested'"
      ),
      pendingComments: one("SELECT COUNT(*) c FROM comments WHERE status = 'pending'"),
      publishedPosts: one("SELECT COUNT(*) c FROM posts WHERE status = 'published'"),
      scheduledPosts: one("SELECT COUNT(*) c FROM posts WHERE status = 'scheduled'"),
    },
  };
}
