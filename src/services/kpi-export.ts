import { getVendorKpis, getPlatformKpis } from "./kpis.js";
import { getVendorById } from "./vendor.js";

function csvEscape(val: string | number | null | undefined): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvEscape).join(",");
}

export function vendorKpisToCsv(vendorId: number): string {
  const k = getVendorKpis(vendorId);
  const vendor = getVendorById(vendorId);
  const rows = [
    ["SocialAI Pro — Vendor KPI Report"],
    ["Vendor", vendor?.name ?? vendorId],
    ["Month", k.month],
    ["Generated", new Date().toISOString()],
    [],
    ["Section", "Metric", "Value"],
    ["Engagement", "Total conversations", k.engagement.totalConversations],
    ["Engagement", "New conversations (7d)", k.engagement.newConversations7d],
    ["Engagement", "Active conversations (7d)", k.engagement.activeConversations7d],
    ["Engagement", "Messages in", k.engagement.messagesIn],
    ["Engagement", "Messages out", k.engagement.messagesOut],
    ["Engagement", "Messenger chats", k.engagement.byChannel.messenger],
    ["Engagement", "WhatsApp chats", k.engagement.byChannel.whatsapp],
    ["Engagement", "Instagram chats", k.engagement.byChannel.instagram],
    ["Support", "Inbox pending", k.support.pendingInbox],
    ["Support", "Handoff queue", k.support.handoffQueue],
    ["Support", "Handoff active", k.support.handoffActive],
    ["Support", "Comments pending", k.support.pendingComments],
    ["Sales", "Total orders", k.sales.totalOrders],
    ["Sales", "Orders this month", k.sales.ordersThisMonth],
    ["Sales", "Pending orders", k.sales.pendingOrders],
    ["Sales", "Confirmed orders", k.sales.confirmedOrders],
    ["Sales", "Delivered orders", k.sales.deliveredOrders],
    ["Sales", "Active products", k.sales.productsActive],
    ["AI", "AI replies", k.ai.aiReplies],
    ["AI", "Tokens in", k.ai.tokensIn],
    ["AI", "Tokens out", k.ai.tokensOut],
    ["AI", "Est. cost USD", k.ai.costUsd.toFixed(4)],
    ["AI", "Automation rate %", k.ai.automationRate],
    ["AI", "Quota used %", k.ai.quotaUsedPct],
    ["Content", "Published posts", k.content.publishedPosts],
    ["Content", "Scheduled posts", k.content.scheduledPosts],
    ["Content", "Comments replied", k.content.commentsReplied],
    [],
    ["Daily AI (last 7 days)", "Date", "Calls", "Tokens in", "Tokens out", "Cost USD"],
    ...k.dailyAi.map((d) => ["", d.date, d.calls, d.tokensIn, d.tokensOut, d.costUsd.toFixed(4)]),
  ];
  if (k.dailyEngagement?.length) {
    rows.push([], ["Daily messages (last 7 days)", "Date", "Messages in", "Messages out"]);
    rows.push(...k.dailyEngagement.map((d) => ["", d.date, d.messagesIn, d.messagesOut]));
  }
  return "\uFEFF" + rows.map((r) => csvRow(r)).join("\n");
}

export function platformKpisToCsv(): string {
  const k = getPlatformKpis();
  const b = k.business;
  const u = k.usage;
  const r = k.revenue;
  const o = k.operations;
  const rows = [
    ["SocialAI Pro — Platform KPI Report"],
    ["Month", k.month],
    ["Generated", new Date().toISOString()],
    [],
    ["Section", "Metric", "Value"],
    ["Business", "Total vendors", b.totalVendors],
    ["Business", "Active vendors", b.activeVendors],
    ["Business", "Trial vendors", b.trialVendors],
    ["Business", "Suspended vendors", b.suspendedVendors],
    ["Business", "New vendors this month", b.newVendorsThisMonth],
    ["Business", "Trial plan count", b.byPlan.trial],
    ["Business", "Pro plan count", b.byPlan.pro],
    ["Business", "Elite plan count", b.byPlan.elite],
    ["Business", "Enterprise plan count", b.byPlan.enterprise],
    ["Usage", "AI replies this month", u.aiRepliesThisMonth],
    ["Usage", "Messages in", u.messagesInThisMonth],
    ["Usage", "Messages out", u.messagesOutThisMonth],
    ["Usage", "LLM tokens in", u.tokensInThisMonth],
    ["Usage", "LLM tokens out", u.tokensOutThisMonth],
    ["Usage", "Est. AI cost USD", u.aiCostUsdThisMonth.toFixed(4)],
    ["Usage", "Total conversations", u.totalConversations],
    ["Usage", "Total messages", u.totalMessages],
    ["Revenue", "Revenue BDT this month", r.revenueBdtThisMonth],
    ["Revenue", "Completed payments", r.completedPaymentsThisMonth],
    ["Revenue", "Pending payments", r.pendingPayments],
    ["Revenue", "MRR estimate BDT", r.mrrEstimate],
    ["Operations", "Total orders", o.totalOrders],
    ["Operations", "Pending orders", o.pendingOrders],
    ["Operations", "Handoff queue", o.handoffQueue],
    ["Operations", "Pending comments", o.pendingComments],
    [],
    ["Daily AI (last 7 days)", "Date", "Calls", "Tokens in", "Tokens out", "Cost USD"],
    ...u.dailyAi.map((d) => ["", d.date, d.calls, d.tokensIn, d.tokensOut, d.costUsd.toFixed(4)]),
  ];
  return "\uFEFF" + rows.map((r) => csvRow(r)).join("\n");
}

function reportStyle(): string {
  return `
    body { font-family: system-ui, sans-serif; margin: 32px; color: #111; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .05em; color: #444; margin: 24px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee; }
    th { background: #f5f5f5; font-weight: 600; }
    .num { font-weight: 700; }
    @media print { body { margin: 16px; } }
  `;
}

export function vendorKpiReportHtml(vendorId: number): string {
  const k = getVendorKpis(vendorId);
  const vendor = getVendorById(vendorId);
  const name = vendor?.name ?? `Vendor #${vendorId}`;
  const section = (title: string, rows: [string, string | number][]) => `
    <h2>${title}</h2>
    <table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>
    ${rows.map(([m, v]) => `<tr><td>${m}</td><td class="num">${v}</td></tr>`).join("")}
    </tbody></table>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>KPI Report — ${name}</title><style>${reportStyle()}</style></head><body>
    <h1>Vendor KPI Report</h1>
    <div class="meta">${name} · ${k.month} · Generated ${new Date().toLocaleString()}</div>
    ${section("Engagement", [
      ["Total conversations", k.engagement.totalConversations],
      ["New (7 days)", k.engagement.newConversations7d],
      ["Messages in", k.engagement.messagesIn],
      ["Messages out", k.engagement.messagesOut],
      ["Messenger / WA / IG", `${k.engagement.byChannel.messenger} / ${k.engagement.byChannel.whatsapp} / ${k.engagement.byChannel.instagram}`],
    ])}
    ${section("Support", [
      ["Inbox pending", k.support.pendingInbox],
      ["Handoff queue", k.support.handoffQueue],
      ["Comments pending", k.support.pendingComments],
    ])}
    ${section("Sales", [
      ["Total orders", k.sales.totalOrders],
      ["Orders this month", k.sales.ordersThisMonth],
      ["Pending", k.sales.pendingOrders],
      ["Active products", k.sales.productsActive],
    ])}
    ${section("AI & tokens", [
      ["AI replies", k.ai.aiReplies],
      ["Tokens (in + out)", k.ai.tokensIn + k.ai.tokensOut],
      ["Est. cost", `$${k.ai.costUsd.toFixed(4)}`],
      ["Automation rate", `${k.ai.automationRate}%`],
      ["Plan", k.ai.planName],
    ])}
    <script>window.onload=()=>window.print()</script>
  </body></html>`;
}

export function platformKpiReportHtml(): string {
  const k = getPlatformKpis();
  const b = k.business;
  const u = k.usage;
  const r = k.revenue;
  const section = (title: string, rows: [string, string | number][]) => `
    <h2>${title}</h2>
    <table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>
    ${rows.map(([m, v]) => `<tr><td>${m}</td><td class="num">${v}</td></tr>`).join("")}
    </tbody></table>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Platform KPI Report</title><style>${reportStyle()}</style></head><body>
    <h1>Platform KPI Report</h1>
    <div class="meta">SocialAI Pro · ${k.month} · Generated ${new Date().toLocaleString()}</div>
    ${section("Business", [
      ["Total vendors", b.totalVendors],
      ["Active / Trial / Suspended", `${b.activeVendors} / ${b.trialVendors} / ${b.suspendedVendors}`],
      ["New this month", b.newVendorsThisMonth],
      ["Plans (T/P/E/Ent)", `${b.byPlan.trial}/${b.byPlan.pro}/${b.byPlan.elite}/${b.byPlan.enterprise}`],
    ])}
    ${section("Usage & AI", [
      ["AI replies", u.aiRepliesThisMonth],
      ["Messages in / out", `${u.messagesInThisMonth} / ${u.messagesOutThisMonth}`],
      ["LLM tokens", u.tokensInThisMonth + u.tokensOutThisMonth],
      ["Est. AI cost", `$${u.aiCostUsdThisMonth.toFixed(4)}`],
      ["Conversations", u.totalConversations],
    ])}
    ${section("Revenue", [
      ["Revenue BDT", `৳${r.revenueBdtThisMonth}`],
      ["MRR estimate", `৳${r.mrrEstimate}`],
      ["Pending payments", r.pendingPayments],
    ])}
    <script>window.onload=()=>window.print()</script>
  </body></html>`;
}
