/* SocialAI Pro — Multi-vendor Dashboard */
(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  };
  const esc = (s) =>
    (s ?? "").toString().replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const TOKEN_KEY = "sap_token";
  const USER_KEY = "sap_user";
  const VENDOR_KEY = "sap_vendor";

  let token = localStorage.getItem(TOKEN_KEY) || "";
  let user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
  let vendor = JSON.parse(localStorage.getItem(VENDOR_KEY) || "null");
  let currentView = "dashboard";
  let activeConv = null;
  let manageVendorId = null;
  let orderFilter = "";
  let inboxChannel = "";
  const isAdmin = () => user?.role === "super_admin";

  const VENDOR_NAV = [
    { id: "dashboard", label: "Dashboard" },
    { id: "analytics", label: "Analytics" },
    { id: "channels", label: "Channels" },
    { id: "knowledge", label: "Knowledge" },
    { id: "products", label: "Products" },
    { id: "inbox", label: "Inbox", badge: "badgeInbox" },
    { id: "orders", label: "Orders", badge: "badgeOrders" },
    { id: "comments", label: "Comments", badge: "badgeComments" },
    { id: "posts", label: "Posts" },
    { id: "billing", label: "Plan & Billing" },
  ];
  const CHANNEL_TAGS = { messenger: "MSG", whatsapp: "WA", instagram: "IG" };
  const CHANNEL_META = {
    messenger: { icon: "💬", label: "Messenger & Facebook", hint: "Page ID + Page Access Token from Meta Developer" },
    whatsapp: { icon: "📱", label: "WhatsApp Business", hint: "Phone Number ID + token from Meta WhatsApp API" },
    instagram: { icon: "📸", label: "Instagram DM", hint: "Instagram Business Account ID linked to your Facebook Page" },
  };
  const ADMIN_NAV = [
    { id: "admin-dashboard", label: "Platform" },
    { id: "admin-analytics", label: "Analytics" },
    { id: "admin-ai", label: "AI Config" },
    { id: "admin-payments", label: "Payment Config" },
    { id: "admin-billing", label: "Payment Queue" },
    { id: "admin-vendors", label: "Vendors" },
    { id: "admin-manage", label: "Manage Vendor" },
  ];

  async function api(path, opts = {}) {
    const base = path.startsWith("/auth") || path.startsWith("/admin") ? "/api" : "/api";
    const isAuthAttempt = path.startsWith("/auth/login") || path.startsWith("/auth/register");
    const res = await fetch(base + path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(!isAuthAttempt && token ? { Authorization: "Bearer " + token } : {}),
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !isAuthAttempt) {
      logout();
      throw new Error("Session expired. Please sign in again.");
    }
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function downloadCsv(path, filename) {
    const res = await fetch("/api" + path, {
      headers: { ...(token ? { Authorization: "Bearer " + token } : {}) },
    });
    if (res.status === 401) { logout(); throw new Error("Session expired."); }
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function openKpiReport(path) {
    const res = await fetch("/api" + path, {
      headers: { ...(token ? { Authorization: "Bearer " + token } : {}) },
    });
    if (res.status === 401) { logout(); throw new Error("Session expired."); }
    if (!res.ok) throw new Error("Report failed");
    const html = await res.text();
    const w = window.open("", "_blank");
    if (!w) return toast("Allow popups to open PDF report", "err");
    w.document.write(html);
    w.document.close();
  }

  function bindExportBar(root, prefix) {
    root.querySelector("[data-export-csv]")?.addEventListener("click", async () => {
      try {
        await downloadCsv(`${prefix}/kpis/export.csv`, `kpi-report${prefix ? "-platform" : ""}.csv`);
        toast("CSV exported ✓", "ok");
      } catch (e) { toast(e.message, "err"); }
    });
    root.querySelector("[data-export-pdf]")?.addEventListener("click", async () => {
      try {
        await openKpiReport(`${prefix}/kpis/report`);
        toast("PDF report opened — use Print → Save as PDF", "ok");
      } catch (e) { toast(e.message, "err"); }
    });
  }

  function exportBar(prefix) {
    return `<div class="export-bar">
      <button class="btn btn-sm" data-export-csv>📥 Export CSV</button>
      <button class="btn btn-sm" data-export-pdf>📄 PDF Report</button>
    </div>`;
  }

  function dayLabels(rows) {
    return (rows || []).map((d) => (d.date || "").slice(5));
  }

  async function apiForm(path, formData, method = "POST") {
    const res = await fetch("/api" + path, {
      method,
      headers: { ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: formData,
    });
    if (res.status === 401) { logout(); throw new Error("Session expired. Please sign in again."); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  let toastTimer;
  function toast(msg, type = "") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show " + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = "toast"), 3200);
  }

  function saveSession(t, u, v) {
    token = t; user = u; vendor = v;
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    localStorage.setItem(VENDOR_KEY, JSON.stringify(v));
  }

  function logout() {
    token = ""; user = null; vendor = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(VENDOR_KEY);
    $("#app").classList.add("hidden");
    $("#login").classList.remove("hidden");
  }

  function buildNav() {
    const nav = $("#nav");
    nav.innerHTML = "";
    const items = isAdmin() ? ADMIN_NAV : VENDOR_NAV;
    items.forEach((item) => {
      const btn = el("button", "nav-item" + (currentView === item.id ? " active" : ""));
      btn.dataset.view = item.id;
      btn.innerHTML = `${item.label}` + (item.badge ? ` <i class="badge" id="${item.badge}"></i>` : "");
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentView = item.id;
        $("#viewTitle").textContent = item.label;
        render();
      });
      nav.appendChild(btn);
    });
  }

  function showApp() {
    handleMetaOAuthReturn();
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    $("#vendorLabel").textContent = isAdmin() ? "Super Admin" : (vendor?.name || "Vendor");
    const planPill = $("#planPill");
    if (vendor && !isAdmin()) {
      planPill.textContent = `Plan: ${vendor.plan} · ${vendor.status}`;
      planPill.classList.remove("hidden");
    } else planPill.classList.add("hidden");
    buildNav();
    if (isAdmin()) currentView = "admin-dashboard";
    else if (!VENDOR_NAV.find((n) => n.id === currentView)) currentView = "dashboard";
    document.querySelectorAll(".nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === currentView);
    });
    $("#viewTitle").textContent = (isAdmin() ? ADMIN_NAV : VENDOR_NAV).find((n) => n.id === currentView)?.label || "Dashboard";
    refreshStatus();
    if (!isAdmin()) refreshBadges();
    render();
  }

  function switchAuthTab(name) {
    const tab = document.querySelector(`#authTabs .tab[data-tab="${name}"]`);
    if (!tab) return;
    document.querySelectorAll("#authTabs .tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".auth-panel").forEach((p) => p.classList.add("hidden"));
    const panelId = { login: "#loginForm", register: "#registerForm", admin: "#adminForm" }[name];
    $(panelId)?.classList.remove("hidden");
  }

  document.querySelectorAll("#authTabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => switchAuthTab(tab.dataset.tab));
  });

  const hashTab = (location.hash || "").replace("#", "");
  if (hashTab === "register" || hashTab === "admin") switchAuthTab(hashTab);

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: $("#loginEmail").value, password: $("#loginPass").value }),
      });
      if (r.user.role === "super_admin") return toast("Use Admin tab for super admin login", "err");
      saveSession(r.token, r.user, r.vendor);
      $("#loginError").textContent = "";
      showApp();
    } catch (err) { $("#loginError").textContent = err.message; }
  });

  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          businessName: $("#regBusiness").value, ownerName: $("#regOwner").value,
          email: $("#regEmail").value, password: $("#regPass").value,
        }),
      });
      saveSession(r.token, r.user, r.vendor);
      toast("Welcome to SocialAI Pro! 14-day trial started.", "ok");
      showApp();
    } catch (err) { toast(err.message, "err"); }
  });

  $("#adminForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#loginError").textContent = "";
    try {
      token = "";
      localStorage.removeItem(TOKEN_KEY);
      const r = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: $("#adminEmail").value, password: $("#adminPass").value }),
      });
      if (r.user.role !== "super_admin") return toast("Not a super admin account", "err");
      saveSession(r.token, r.user, null);
      showApp();
    } catch (err) { $("#loginError").textContent = err.message; }
  });

  $("#logoutBtn").addEventListener("click", logout);
  $("#refreshBtn").addEventListener("click", () => { refreshStatus(); if (!isAdmin()) refreshBadges(); render(); });

  async function refreshStatus() {
    try {
      if (isAdmin()) {
        const k = await api("/admin/kpis");
        const u = k.usage || {};
        const r = k.revenue || {};
        $("#statusPill").textContent = `Admin · ${fmtNum(u.aiRepliesThisMonth)} AI · ${fmtCost(u.aiCostUsdThisMonth)} · ${r.pendingPayments || 0} pay`;
        return;
      }
      const s = await api("/status");
      const ch = s.channels || {};
      const on = [ch.messenger && "MSG", ch.whatsapp && "WA", ch.instagram && "IG"].filter(Boolean).join(" ");
      $("#statusPill").textContent = `AI ${s.ai.configured ? "✓" : "✗"} · ${on || "no channels"} · ${s.usage.used}/${s.usage.limit < 0 ? "∞" : s.usage.limit}`;
    } catch { $("#statusPill").textContent = "offline"; }
  }

  async function refreshBadges() {
    try {
      const a = await api("/analytics");
      setBadge("#badgeInbox", (a.pendingMessages || 0) + (a.handoffQueue || 0));
      setBadge("#badgeOrders", a.pendingOrders || 0);
      setBadge("#badgeComments", a.pendingComments);
    } catch {}
  }

  function handoffLabel(status) {
    if (status === "human_requested") return '<span class="pill handoff">🙋 Human requested</span>';
    if (status === "human_active") return '<span class="pill handoff-active">👤 You are replying</span>';
    return "";
  }
  function setBadge(sel, n) {
    const b = $(sel); if (!b) return;
    if (n > 0) { b.textContent = n; b.classList.add("show"); } else b.classList.remove("show");
  }

  function render() {
    window.KpiCharts?.destroyAll();
    const v = $("#view");
    v.innerHTML = "<div class='empty'>Loading…</div>";
    const routes = {
      dashboard: renderDashboard, analytics: renderAnalytics,
      channels: renderChannels, knowledge: renderKnowledge,
      products: renderProducts, inbox: renderInbox, orders: renderOrders,
      comments: renderComments, posts: renderPosts, billing: renderBilling,
      "admin-dashboard": renderAdminDashboard, "admin-analytics": renderAdminAnalytics,
      "admin-ai": renderAdminAi, "admin-payments": renderAdminPayments,
      "admin-billing": renderAdminBilling, "admin-vendors": renderAdminVendors,
      "admin-manage": renderAdminManage,
    };
    (routes[currentView] || renderDashboard)(v);
  }

  // ---- KPI helpers ----
  function fmtDelta(pct) {
    if (pct == null) return `<span class="kpi-delta flat">—</span>`;
    const cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    const sign = pct > 0 ? "+" : "";
    return `<span class="kpi-delta ${cls}">${sign}${pct}% vs last month</span>`;
  }
  function fmtCost(usd) {
    if (!usd || usd < 0.0001) return "$0.00";
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  }
  function fmtNum(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 10_000) return (n / 1_000).toFixed(1) + "K";
    return String(n ?? 0);
  }
  function kpiCard(num, label, sub, delta) {
    return `<div class="kpi-card"><div class="kpi-num">${num}</div><div class="kpi-label">${label}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ""}${delta || ""}</div>`;
  }
  function renderSpark(daily, key = "calls") {
    if (!daily?.length) return `<div class="muted" style="font-size:12px">No AI activity yet</div>`;
    const max = Math.max(...daily.map((d) => d[key] || 0), 1);
    const bars = daily.map((d) => {
      const h = Math.max(8, Math.round(((d[key] || 0) / max) * 100));
      return `<div class="spark-bar" style="height:${h}%" title="${d.date}: ${d[key] || 0}"></div>`;
    }).join("");
    const labels = daily.map((d) => `<span>${(d.date || "").slice(5)}</span>`).join("");
    return `<div class="spark-wrap">${bars}</div><div class="spark-labels">${labels}</div>`;
  }
  function adoptionBar(label, pct, connected, total) {
    return `<div class="adoption-bar"><span style="min-width:90px">${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="muted">${connected}/${total} (${pct}%)</span></div>`;
  }

  function handleMetaOAuthReturn() {
    const p = new URLSearchParams(location.search);
    const status = p.get("meta_oauth");
    if (!status) return;
    if (status === "pages") { currentView = "channels"; toast("Select your Facebook Page below", "ok"); }
    else if (status === "denied") toast("Meta login cancelled", "err");
    else if (status === "no_pages") {
      currentView = "channels";
      toast("No Pages returned — use the Facebook account that owns the Page, grant all permissions, then try again", "err");
    }
    else if (status === "error") toast("Meta connection failed — check admin Meta App config", "err");
    history.replaceState({}, "", "/app");
  }

  // ---- Vendor views ----
  function channelChip(id, on, allowed) {
    const m = CHANNEL_META[id];
    const cls = on ? "ok" : allowed ? "warn" : "off";
    const sub = on ? "Connected" : allowed ? "Not configured" : "Upgrade plan";
    return `<div class="channel-card ${cls}"><span class="ch-icon">${m.icon}</span><strong>${m.label}</strong><span class="muted">${sub}</span></div>`;
  }

  async function renderDashboard(v) {
    try {
      const k = await api("/kpis");
      const e = k.engagement || {};
      const s = k.support || {};
      const sales = k.sales || {};
      const ai = k.ai || {};
      const c = k.content || {};
      const tr = k.trends || {};
      const ch = k.channels || {};
      const pct = ai.quotaUsedPct ?? 0;
      const setupNeeded = !(ch.messenger || ch.whatsapp || ch.instagram);
      v.innerHTML = `${exportBar("")}
      <div class="panel"><div class="kpi-section"><h3>📊 Engagement · ${esc(k.month)}</h3>
      <div class="kpi-grid">
        ${kpiCard(fmtNum(e.totalConversations), "Total chats", `${e.newConversations7d} new (7d)`)}
        ${kpiCard(fmtNum(e.activeConversations7d), "Active (7d)", "Updated recently")}
        ${kpiCard(fmtNum(e.messagesIn), "Messages in", fmtDelta(tr.messagesInDeltaPct))}
        ${kpiCard(fmtNum(e.messagesOut), "Messages out", fmtDelta(tr.messagesOutDeltaPct))}
      </div></div></div>
      <div class="panel"><div class="kpi-section"><h3>🛟 Support</h3>
      <div class="kpi-grid">
        ${kpiCard(s.pendingInbox, "Inbox pending", "Awaiting your reply")}
        ${kpiCard(s.handoffQueue, "Handoff queue", "Human requested")}
        ${kpiCard(s.handoffActive, "You replying", "Active handoffs")}
        ${kpiCard(s.pendingComments, "Comments", "Pending review")}
      </div></div></div>
      <div class="panel"><div class="kpi-section"><h3>💰 Sales</h3>
      <div class="kpi-grid">
        ${kpiCard(sales.totalOrders, "Total orders", `${sales.ordersThisMonth} this month`)}
        ${kpiCard(sales.pendingOrders, "Pending", "Need confirmation")}
        ${kpiCard(sales.confirmedOrders, "Confirmed", "")}
        ${kpiCard(sales.productsActive, "Products", "Active in catalog")}
      </div></div></div>
      <div class="panel"><div class="kpi-section"><h3>🤖 AI & tokens · ${esc(ai.planName)}</h3>
      <div class="kpi-grid">
        ${kpiCard(fmtNum(ai.aiReplies), "AI replies", fmtDelta(tr.aiRepliesDeltaPct))}
        ${kpiCard(fmtNum(ai.tokensIn + ai.tokensOut), "Tokens used", `~${ai.avgTokensPerReply}/reply`)}
        ${kpiCard(fmtCost(ai.costUsd), "Est. AI cost", esc(ai.provider))}
        ${kpiCard(`${ai.automationRate}%`, "Automation rate", "AI vs inbound")}
      </div>
      <p style="margin-top:10px;font-size:12px">Quota: <b>${ai.aiReplies}</b> / ${ai.quotaLimit < 0 ? "∞" : ai.quotaLimit} AI replies</p>
      <div class="usage-bar"><div class="usage-bar-fill" style="width:${pct}%"></div></div>
      <div class="chart-canvas-wrap" style="margin-top:12px"><canvas id="dashAiLine"></canvas></div>
      </div></div>
      <div class="panel"><div class="kpi-section"><h3>📣 Content & channels</h3>
      <div class="kpi-grid">
        ${kpiCard(c.publishedPosts, "Published", `${c.scheduledPosts} scheduled`)}
        ${kpiCard(c.commentsReplied, "Comments sent", `${c.drafts} drafts`)}
        ${kpiCard(`${e.byChannel?.messenger||0}`, "Messenger chats", ch.messenger?"✓":"setup")}
        ${kpiCard(`${(e.byChannel?.whatsapp||0)+(e.byChannel?.instagram||0)}`, "WA + IG chats", `${ch.whatsapp?"WA✓":""} ${ch.instagram?"IG✓":""}`)}
      </div>
      ${setupNeeded ? `<p class="muted" style="margin-top:12px"><a href="#" data-goto="channels" class="link-neon">Connect channels →</a> · <a href="#" data-goto="knowledge" class="link-neon">Knowledge base →</a></p>` : ""}
      <p class="muted" style="margin-top:10px"><a href="#" data-goto="analytics" class="link-neon">Open full Analytics dashboard →</a></p>
      </div></div>`;
      bindExportBar(v, "");
      v.querySelectorAll("[data-goto]").forEach((lnk) => lnk.addEventListener("click", (ev) => {
        ev.preventDefault(); currentView = lnk.dataset.goto; showApp();
      }));
      window.KpiCharts?.line("dashAiLine", dayLabels(k.dailyAi), [
        { label: "AI calls", data: (k.dailyAi || []).map((d) => d.calls), color: "#00e5ff" },
      ]);
    } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function renderAnalytics(v) {
    try {
      const k = await api("/kpis");
      const e = k.engagement || {};
      const ai = k.ai || {};
      const sales = k.sales || {};
      v.innerHTML = `${exportBar("")}
      <div class="panel"><h3>Analytics · ${esc(k.month)}</h3>
      <p class="section-hint">Charts, trends, and exportable KPI reports for your business.</p>
      <div class="kpi-grid" style="margin-top:12px">
        ${kpiCard(fmtNum(ai.aiReplies), "AI replies", fmtDelta(k.trends?.aiRepliesDeltaPct))}
        ${kpiCard(fmtCost(ai.costUsd), "AI cost", esc(ai.provider))}
        ${kpiCard(fmtNum(e.messagesIn), "Messages in", fmtDelta(k.trends?.messagesInDeltaPct))}
        ${kpiCard(sales.totalOrders, "Orders", `${sales.ordersThisMonth} this month`)}
      </div>
      <div class="chart-grid">
        <div class="chart-box"><h4>AI calls (7 days)</h4><div class="chart-canvas-wrap"><canvas id="anAiLine"></canvas></div></div>
        <div class="chart-box"><h4>LLM tokens (7 days)</h4><div class="chart-canvas-wrap"><canvas id="anTokenLine"></canvas></div></div>
        <div class="chart-box"><h4>Messages in / out (7 days)</h4><div class="chart-canvas-wrap"><canvas id="anMsgLine"></canvas></div></div>
        <div class="chart-box"><h4>Conversations by channel</h4><div class="chart-canvas-wrap"><canvas id="anChBar"></canvas></div></div>
        <div class="chart-box"><h4>Orders by status</h4><div class="chart-canvas-wrap"><canvas id="anOrdBar"></canvas></div></div>
        <div class="chart-box"><h4>AI cost (7 days)</h4><div class="chart-canvas-wrap"><canvas id="anCostLine"></canvas></div></div>
      </div></div>`;
      bindExportBar(v, "");
      const dl = dayLabels(k.dailyAi);
      const de = dayLabels(k.dailyEngagement);
      const KC = window.KpiCharts;
      KC?.line("anAiLine", dl, [{ label: "Calls", data: (k.dailyAi || []).map((d) => d.calls), color: "#00e5ff" }]);
      KC?.line("anTokenLine", dl, [
        { label: "Tokens in", data: (k.dailyAi || []).map((d) => d.tokensIn), color: "#a78bfa" },
        { label: "Tokens out", data: (k.dailyAi || []).map((d) => d.tokensOut), color: "#34d399" },
      ]);
      KC?.line("anMsgLine", de, [
        { label: "In", data: (k.dailyEngagement || []).map((d) => d.messagesIn), color: "#38bdf8" },
        { label: "Out", data: (k.dailyEngagement || []).map((d) => d.messagesOut), color: "#fb923c" },
      ]);
      KC?.bar("anChBar", ["Messenger", "WhatsApp", "Instagram"],
        [e.byChannel?.messenger||0, e.byChannel?.whatsapp||0, e.byChannel?.instagram||0], "Chats", "#00e5ff");
      KC?.bar("anOrdBar", ["Pending", "Confirmed", "Delivered"],
        [sales.pendingOrders||0, sales.confirmedOrders||0, sales.deliveredOrders||0], "Orders", "#34d399");
      KC?.line("anCostLine", dl, [{ label: "USD", data: (k.dailyAi || []).map((d) => d.costUsd), color: "#fbbf24" }]);
    } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function renderChannels(v) {
    try {
      const [cfg, metaPages] = await Promise.all([
        api("/settings"),
        api("/meta/oauth/pages").catch(() => ({ pages: [], configured: false })),
      ]);
      const vals = cfg.values || {};
      const ch = cfg.channels || {};
      const wh = cfg.webhooks || {};
      const chip = (id) => {
        const c = ch[id] || {};
        const cls = c.configured ? "ok" : c.allowed ? "warn" : "off";
        return `<span class="status-chip ${cls}">${CHANNEL_META[id].icon} ${CHANNEL_META[id].label} — ${c.configured ? "connected" : c.allowed ? "setup needed" : "not on plan"}</span>`;
      };
      const pagePicker = metaPages.pages?.length ? `<div class="oauth-panel" id="pagePicker">
        <h4 style="margin:0 0 8px">Select your Facebook Page</h4>
        <p class="section-hint">Messenger, Instagram DM, and WhatsApp auto-configure when linked to the page.</p>
        <div class="page-pick-list">${metaPages.pages.map((p) => `
          <div class="page-pick-item"><div><strong>${esc(p.name)}</strong>
          <div class="muted">${[
            "💬 Messenger",
            p.hasInstagram ? "📸 Instagram" : "",
            p.hasWhatsApp ? "📱 WhatsApp " + esc(p.whatsappDisplayNumber || "") : "",
          ].filter(Boolean).join(" · ")}${!p.hasInstagram && !p.hasWhatsApp ? " (no IG/WA linked on this Page)" : ""}</div></div>
          <button class="btn btn-primary btn-sm" data-page="${esc(p.id)}">Connect</button></div>`).join("")}</div></div>` : "";
      v.innerHTML = `<div class="panel"><h3>Connect your channels</h3>
      <div class="oauth-panel">
        <h4 style="margin:0 0 8px">⚡ Quick connect with Meta</h4>
        <p class="section-hint">One-click OAuth for Facebook Page, Instagram DM, and WhatsApp (when linked in Meta Business).</p>
        <button class="btn btn-primary" id="metaOAuthBtn" ${metaPages.configured ? "" : "disabled"}>Connect with Facebook</button>
        ${!metaPages.configured ? `<p class="muted" style="margin-top:8px;font-size:12px">Ask admin to configure Meta App ID & Secret first.</p>` : ""}
      </div>
      ${pagePicker}
      <p class="section-hint">Or paste tokens manually. Webhooks must point to your server:</p>
      <div class="status-row">${chip("messenger")}${chip("whatsapp")}${chip("instagram")}</div>
      <div class="webhook-box"><code>Messenger/FB: ${esc(location.origin + wh.messenger)}</code>
      <code>WhatsApp: ${esc(location.origin + wh.whatsapp)}</code>
      <code>Instagram: ${esc(location.origin + wh.instagram)}</code></div></div>
      <details class="config-section" open><summary>💬 Messenger & Facebook Page</summary><div class="config-body">
      <p class="section-hint">${esc(CHANNEL_META.messenger.hint)}</p>
      <label class="field">Page ID</label><input class="inp vk" data-key="FB_PAGE_ID" value="${esc(vals.FB_PAGE_ID||"")}" />
      <label class="field">Page Access Token</label><input class="inp vk" data-key="FB_PAGE_ACCESS_TOKEN" data-secret=1 type="password" value="${esc(vals.FB_PAGE_ACCESS_TOKEN||"")}" />
      <label class="field">Graph API version</label><input class="inp vk" data-key="FB_GRAPH_VERSION" value="${esc(vals.FB_GRAPH_VERSION||"v21.0")}" />
      </div></details>
      <details class="config-section" ${ch.whatsapp?.allowed?"open":""}><summary>📱 WhatsApp Business</summary><div class="config-body">
      <p class="section-hint">${esc(CHANNEL_META.whatsapp.hint)}</p>
      <label class="field">Phone Number ID</label><input class="inp vk" data-key="WA_PHONE_NUMBER_ID" value="${esc(vals.WA_PHONE_NUMBER_ID||"")}" ${ch.whatsapp?.allowed?"":"disabled"} />
      <label class="field">WhatsApp Access Token</label><input class="inp vk" data-key="WA_ACCESS_TOKEN" data-secret=1 type="password" value="${esc(vals.WA_ACCESS_TOKEN||"")}" ${ch.whatsapp?.allowed?"":"disabled"} />
      ${!ch.whatsapp?.allowed ? `<p class="muted">Upgrade to Pro for WhatsApp. <a href="#" data-goto="billing" class="link-neon">View plans</a></p>` : ""}
      </div></details>
      <details class="config-section" ${ch.instagram?.allowed?"open":""}><summary>📸 Instagram DM</summary><div class="config-body">
      <p class="section-hint">${esc(CHANNEL_META.instagram.hint)}</p>
      <label class="field">Instagram Account ID</label><input class="inp vk" data-key="IG_ACCOUNT_ID" value="${esc(vals.IG_ACCOUNT_ID||"")}" ${ch.instagram?.allowed?"":"disabled"} />
      ${!ch.instagram?.allowed ? `<p class="muted">Upgrade to Pro for Instagram. <a href="#" data-goto="billing" class="link-neon">View plans</a></p>` : ""}
      </div></details>
      <details class="config-section"><summary>⚙️ Automation behaviour</summary><div class="config-body">
      <label class="field">Auto-reply messages</label><select class="inp vk" data-key="AUTO_REPLY_MESSAGES"><option value="false" ${vals.AUTO_REPLY_MESSAGES==="false"?"selected":""}>false</option><option value="true" ${vals.AUTO_REPLY_MESSAGES==="true"?"selected":""}>true</option></select>
      <label class="field">Auto-reply comments</label><select class="inp vk" data-key="AUTO_REPLY_COMMENTS"><option value="false" ${vals.AUTO_REPLY_COMMENTS==="false"?"selected":""}>false</option><option value="true" ${vals.AUTO_REPLY_COMMENTS==="true"?"selected":""}>true</option></select>
      <label class="field">Reply language</label><select class="inp vk" data-key="REPLY_LANGUAGE">${["banglish","bangla","english","auto"].map((l)=>`<option ${vals.REPLY_LANGUAGE===l?"selected":""}>${l}</option>`).join("")}</select>
      </div></details>
      <div class="actions"><button class="btn btn-primary" id="saveChannels">Save channel settings</button></div>`;
      $("#metaOAuthBtn")?.addEventListener("click", async () => {
        try {
          const r = await api("/meta/oauth/url");
          window.location.href = r.url;
        } catch (e) { toast(e.message, "err"); }
      });
      v.querySelectorAll("[data-page]").forEach((btn) => btn.addEventListener("click", async () => {
        try {
          const r = await api("/meta/oauth/select", { method: "POST", body: JSON.stringify({ pageId: btn.dataset.page }) });
          const extra = [r.page.instagramAccountId && "Instagram", r.page.whatsappPhoneNumberId && "WhatsApp"].filter(Boolean).join(" + ");
          toast(`Connected ${r.page.name}${extra ? " (" + extra + ")" : ""} ✓`, "ok");
          renderChannels(v);
        } catch (e) { toast(e.message, "err"); }
      }));
      v.querySelector("[data-goto]")?.addEventListener("click", (e) => { e.preventDefault(); currentView = "billing"; showApp(); });
      $("#saveChannels").addEventListener("click", async () => {
        const values = {};
        v.querySelectorAll(".vk").forEach((n) => {
          if (n.disabled) return;
          if (n.getAttribute("data-secret")==="1" && (n.value===""||n.value.startsWith("••••"))) return;
          values[n.getAttribute("data-key")] = n.value;
        });
        await api("/settings", { method: "PUT", body: JSON.stringify({ values }) });
        toast("Channel settings saved ✓", "ok"); refreshStatus(); renderChannels(v);
      });
    } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function renderKnowledge(v) {
    try {
      const kb = await api("/knowledge");
      v.innerHTML = `<div class="panel"><h3>🧠 Knowledge Base</h3>
      <p class="section-hint">Teach your AI about products, prices, delivery, return policy, and FAQs. Markdown supported.</p>
      <textarea class="inp" id="vendorKb" style="min-height:50vh;font-family:ui-monospace,monospace;font-size:13px">${esc(kb.content)}</textarea>
      <div class="actions"><button class="btn btn-primary" id="saveVendorKb">Save knowledge</button></div></div>`;
      $("#saveVendorKb").addEventListener("click", async () => {
        await api("/knowledge", { method: "PUT", body: JSON.stringify({ content: $("#vendorKb").value }) });
        toast("Knowledge saved ✓", "ok");
      });
    } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function renderProducts(v) {
    try {
      v.innerHTML = `<div class="panel"><h3>🛍️ Product Catalog</h3>
      <p class="section-hint">AI can send product photos when customers ask. Set <code>PUBLIC_BASE_URL</code> to your HTTPS URL.</p>
      <div id="vendorProductList"></div>
      <h4 style="margin-top:16px">Add product</h4>
      <div class="row"><input class="inp grow" id="vpName" placeholder="Product name" />
      <input class="inp" id="vpPrice" placeholder="Price e.g. ৳500" style="max-width:140px" /></div>
      <textarea class="inp" id="vpDesc" placeholder="Description" style="min-height:60px;margin-top:8px"></textarea>
      <div class="row" style="margin-top:8px"><input class="inp grow" id="vpLink" placeholder="Product link (optional)" />
      <input class="inp" id="vpImage" type="file" accept="image/*" style="max-width:220px" /></div>
      <div class="actions"><button class="btn btn-primary" id="addVendorProduct">Add product</button></div></div>`;
      const renderList = async () => {
        const products = await api("/products");
        const box = $("#vendorProductList");
        if (!products.length) { box.innerHTML = `<div class="empty" style="padding:20px">No products yet — add your first item above.</div>`; return; }
        box.innerHTML = "";
        products.forEach((p) => {
          const card = el("div", "product-card");
          card.innerHTML = `${p.image_url ? `<img class="product-thumb" src="${esc(p.image_url)}" alt="" />` : `<div class="product-thumb empty-thumb">📷</div>`}
            <div class="product-info"><strong>${esc(p.name)}</strong> ${p.active ? "" : '<span class="pill ignored">inactive</span>'}
            <div class="muted">${esc(p.price || "")} ${p.description ? "· " + esc(p.description).slice(0,60) : ""}</div></div>`;
          const actions = el("div", "actions");
          const toggle = el("button", "btn btn-sm", p.active ? "Deactivate" : "Activate");
          toggle.addEventListener("click", async () => {
            await api(`/products/${p.id}`, { method: "PUT", body: JSON.stringify({ active: !p.active }) });
            renderList(); toast("Updated", "ok");
          });
          const del = el("button", "btn btn-danger btn-sm", "Delete");
          del.addEventListener("click", async () => {
            await api(`/products/${p.id}`, { method: "DELETE" });
            renderList(); toast("Deleted", "ok");
          });
          actions.appendChild(toggle); actions.appendChild(del);
          card.appendChild(actions);
          box.appendChild(card);
        });
      };
      renderList();
      $("#addVendorProduct").addEventListener("click", async () => {
        const name = $("#vpName").value.trim();
        if (!name) return toast("Product name required", "err");
        const fd = new FormData();
        fd.append("name", name);
        fd.append("price", $("#vpPrice").value);
        fd.append("description", $("#vpDesc").value);
        fd.append("link", $("#vpLink").value);
        const file = $("#vpImage").files[0];
        if (file) fd.append("image", file);
        try {
          await apiForm("/products", fd);
          $("#vpName").value = ""; $("#vpPrice").value = ""; $("#vpDesc").value = "";
          $("#vpLink").value = ""; $("#vpImage").value = "";
          renderList(); toast("Product added ✓", "ok");
        } catch (e) { toast(e.message, "err"); }
      });
    } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function renderInbox(v) {
    let convos = [];
    try { convos = await api("/conversations" + (inboxChannel ? `?channel=${inboxChannel}` : "")); } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    convos.sort((a, b) => {
      const rank = (c) => (c.handoff_status === "human_requested" ? 0 : c.handoff_status === "human_active" ? 1 : 2);
      const d = rank(a) - rank(b);
      return d !== 0 ? d : new Date(b.updated_at) - new Date(a.updated_at);
    });
    v.innerHTML = `<div class="channel-bar">
      <span class="lbl">Channel</span>
      <button class="btn btn-sm ${!inboxChannel?"btn-primary":""}" data-ch="">All</button>
      <button class="btn btn-sm ${inboxChannel==="messenger"?"btn-primary":""}" data-ch="messenger">Messenger</button>
      <button class="btn btn-sm ${inboxChannel==="whatsapp"?"btn-primary":""}" data-ch="whatsapp">WhatsApp</button>
      <button class="btn btn-sm ${inboxChannel==="instagram"?"btn-primary":""}" data-ch="instagram">Instagram</button>
    </div>
    <div class="inbox"><div class="conv-list" id="convList"></div><div class="chat" id="chat"><div class="empty">Select a conversation</div></div></div>`;
    v.querySelectorAll("[data-ch]").forEach((btn) => btn.addEventListener("click", () => {
      inboxChannel = btn.dataset.ch; render();
    }));
    const list = $("#convList");
    if (!convos.length) { list.innerHTML = `<div class="empty">No conversations yet.</div>`; return; }
    convos.forEach((c) => {
      const node = el("div", "conv" + (activeConv === c.id ? " active" : "") + (c.handoff_status !== "ai" ? " handoff-conv" : ""));
      const ch = CHANNEL_TAGS[c.channel] || "MSG";
      node.innerHTML = `<div class="name"><span><span class="ch-tag">${ch}</span>${esc(c.customer_name || "Customer")}</span>${c.unread > 0 ? '<span class="dot"></span>' : ""}</div>
        <div class="prev">${handoffLabel(c.handoff_status)} ${esc(c.last_message || "")}</div>`;
      node.addEventListener("click", () => openConversation(c));
      list.appendChild(node);
    });
    if (activeConv) { const c = convos.find((x) => x.id === activeConv); if (c) openConversation(c); }
  }

  async function openConversation(c) {
    activeConv = c.id;
    const chat = $("#chat");
    chat.innerHTML = "<div class='empty'>Loading…</div>";
    const msgs = await api(`/conversations/${c.id}/messages`);
    const handoffBar = c.handoff_status !== "ai"
      ? `<div class="handoff-bar">${handoffLabel(c.handoff_status)}
        ${c.handoff_status === "human_requested" ? '<button class="btn btn-primary btn-sm" id="takeOverBtn">Take over</button><button class="btn btn-sm" id="releaseBtn">Resume AI</button>' : ""}
        ${c.handoff_status === "human_active" ? '<button class="btn btn-sm" id="releaseBtn">Release to AI</button>' : ""}
        </div>` : "";
    chat.innerHTML = `${handoffBar}<div class="chat-body" id="chatBody"></div>
      <div class="chat-foot"><textarea class="inp grow" id="replyBox" placeholder="Type a reply…"></textarea>
      <button class="btn btn-primary" id="sendBtn">Send</button></div>`;
    const body = $("#chatBody");
    msgs.forEach((m) => {
      if (m.status === "pending" && m.direction === "out" && m.ai_draft) {
        const wrap = el("div", "bubble draft");
        wrap.innerHTML = `<div class="draft-tag">🤖 AI DRAFT</div>${esc(m.ai_draft)}`;
        wrap.style.cursor = "pointer";
        wrap.addEventListener("click", () => { $("#replyBox").value = m.ai_draft; });
        body.appendChild(wrap);
      } else if (m.image_url) {
        const wrap = el("div", "bubble out image-bubble");
        wrap.innerHTML = `<img src="${esc(m.image_url)}" alt="product" />${m.text ? `<div>${esc(m.text)}</div>` : ""}`;
        body.appendChild(wrap);
      } else if (m.status !== "ignored" && m.text) {
        body.appendChild(el("div", "bubble " + m.direction, esc(m.text)));
      }
    });
    body.scrollTop = body.scrollHeight;
    $("#sendBtn").addEventListener("click", async () => {
      const text = $("#replyBox").value.trim();
      if (!text) return;
      try {
        if (c.handoff_status === "human_requested") {
          await api(`/conversations/${c.id}/handoff`, { method: "POST", body: JSON.stringify({ action: "take_over" }) });
          c.handoff_status = "human_active";
        }
        await api(`/conversations/${c.id}/reply`, { method: "POST", body: JSON.stringify({ text }) });
        toast("Sent ✓", "ok"); openConversation(c); refreshBadges();
      } catch (e) { toast(e.message, "err"); }
    });
    const takeOver = $("#takeOverBtn");
    if (takeOver) takeOver.addEventListener("click", async () => {
      await api(`/conversations/${c.id}/handoff`, { method: "POST", body: JSON.stringify({ action: "take_over" }) });
      c.handoff_status = "human_active"; openConversation(c); refreshBadges(); toast("You took over this chat", "ok");
    });
    const release = $("#releaseBtn");
    if (release) release.addEventListener("click", async () => {
      await api(`/conversations/${c.id}/handoff`, { method: "POST", body: JSON.stringify({ action: "release" }) });
      c.handoff_status = "ai"; openConversation(c); refreshBadges(); toast("AI resumed", "ok");
    });
  }

  const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];

  async function renderOrders(v) {
    let orders = [];
    const filter = orderFilter;
    try { orders = await api("/orders" + (filter ? `?status=${filter}` : "")); } catch (e) {
      v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return;
    }
    const opts = ORDER_STATUSES.map((s) => `<option value="${s}" ${filter===s?"selected":""}>${s}</option>`).join("");
    v.innerHTML = `<div class="panel"><div class="row" style="align-items:center">
      <h3 style="margin:0;flex:1">🛒 Orders</h3>
      <select class="inp" id="orderFilter" style="max-width:160px"><option value="">All</option>${opts}</select>
      <button class="btn btn-primary" id="exportOrders">📥 Export Excel</button>
      <button class="btn" id="newOrderBtn">➕ Manual order</button></div></div>
      <div id="orderList"></div>
      <div class="panel hidden" id="newOrderPanel"><h3>New order</h3>
      <input class="inp" id="oName" placeholder="Customer name" />
      <input class="inp" id="oPhone" placeholder="Phone" style="margin-top:8px" />
      <input class="inp" id="oAddress" placeholder="Delivery address" style="margin-top:8px" />
      <textarea class="inp" id="oItems" placeholder="Items — one per line: Product name x2 @ ৳500" style="margin-top:8px;min-height:80px"></textarea>
      <div class="actions"><button class="btn btn-primary" id="saveOrder">Save order</button>
      <button class="btn" id="cancelOrder">Cancel</button></div></div>`;
    $("#orderFilter").addEventListener("change", (e) => {
      orderFilter = e.target.value; render();
    });
    $("#exportOrders").addEventListener("click", async () => {
      try {
        const q = filter ? `?status=${filter}` : "";
        await downloadCsv(`/orders/export${q}`, `orders${filter ? "-" + filter : ""}.csv`);
        toast("Exported ✓", "ok");
      } catch (e) { toast(e.message, "err"); }
    });
    $("#newOrderBtn").addEventListener("click", () => $("#newOrderPanel").classList.remove("hidden"));
    $("#cancelOrder").addEventListener("click", () => $("#newOrderPanel").classList.add("hidden"));
    $("#saveOrder").addEventListener("click", async () => {
      const lines = $("#oItems").value.split("\n").map((l) => l.trim()).filter(Boolean);
      const items = lines.map((line) => {
        const m = line.match(/^(.+?)\s*x\s*(\d+)(?:\s*@\s*(.+))?$/i);
        if (m) return { name: m[1].trim(), qty: Number(m[2]), price: m[3]?.trim() };
        return { name: line, qty: 1 };
      });
      try {
        await api("/orders", { method: "POST", body: JSON.stringify({
          customer_name: $("#oName").value, customer_phone: $("#oPhone").value,
          customer_address: $("#oAddress").value, items,
        })});
        toast("Order created ✓", "ok"); $("#newOrderPanel").classList.add("hidden"); renderOrders(v); refreshBadges();
      } catch (e) { toast(e.message, "err"); }
    });
    const box = $("#orderList");
    if (!orders.length) { box.innerHTML = `<div class="empty">No orders yet.</div>`; return; }
    orders.forEach((o) => {
      const item = el("div", "item order-item");
      const itemsText = (o.items || []).map((i) => `${i.name} ×${i.qty}${i.price ? " " + i.price : ""}`).join(", ");
      item.innerHTML = `<div class="head"><span class="who">${esc(o.order_number)} · ${esc(o.customer_name || "Customer")}</span>
        <span class="pill ${o.status}">${o.status}</span></div>
        <div class="msg muted">${esc(o.customer_phone || "")} ${o.customer_address ? "· " + esc(o.customer_address) : ""}</div>
        <div class="msg">${esc(itemsText)}</div>
        <div class="msg"><strong>${esc(o.total || "")}</strong> · ${esc(o.created_at)} · ${o.source}</div>
        <div class="actions"></div>`;
      const actions = item.querySelector(".actions");
      if (o.status === "pending") {
        const confirm = el("button", "btn btn-success btn-sm", "Confirm");
        confirm.addEventListener("click", async () => {
          await api(`/orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: "confirmed" }) });
          renderOrders(v); refreshBadges();
        });
        actions.appendChild(confirm);
      }
      if (o.status === "confirmed") {
        const ship = el("button", "btn btn-primary btn-sm", "Mark shipped");
        ship.addEventListener("click", async () => {
          await api(`/orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: "shipped" }) });
          renderOrders(v);
        });
        actions.appendChild(ship);
      }
      if (o.status === "shipped") {
        const done = el("button", "btn btn-success btn-sm", "Delivered");
        done.addEventListener("click", async () => {
          await api(`/orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: "delivered" }) });
          renderOrders(v);
        });
        actions.appendChild(done);
      }
      if (o.status !== "cancelled" && o.status !== "delivered") {
        const cancel = el("button", "btn btn-danger btn-sm", "Cancel");
        cancel.addEventListener("click", async () => {
          await api(`/orders/${o.id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) });
          renderOrders(v); refreshBadges();
        });
        actions.appendChild(cancel);
      }
      box.appendChild(item);
    });
  }

  async function renderComments(v) {
    let items = [];
    try { items = await api("/comments"); } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (!items.length) { v.innerHTML = `<div class="empty">No comments yet.</div>`; return; }
    v.innerHTML = "";
    items.forEach((c) => {
      const item = el("div", "item");
      item.innerHTML = `<div class="head"><span class="who">${esc(c.from_name || "Someone")}</span><span class="pill ${c.status}">${c.status}</span></div><div class="msg">${esc(c.message)}</div><textarea class="inp draftbox">${esc(c.ai_draft || "")}</textarea><div class="actions"></div>`;
      const ta = item.querySelector("textarea");
      const actions = item.querySelector(".actions");
      if (c.status !== "sent" && c.status !== "ignored") {
        const send = el("button", "btn btn-success btn-sm", "Reply");
        send.addEventListener("click", async () => {
          await api(`/comments/${c.id}/send`, { method: "POST", body: JSON.stringify({ text: ta.value }) });
          render(); refreshBadges();
        });
        actions.append(send);
      }
      v.appendChild(item);
    });
  }

  async function renderBilling(v) {
    try {
      const [usage, plans] = await Promise.all([api("/usage"), fetch("/api/billing/plans").then((r) => r.json())]);
      const planCards = plans.plans.map((p) => `
        <div class="price-card ${p.popular ? "popular" : ""}" style="margin-bottom:16px;padding:24px">
          ${p.popular ? '<span class="popular-badge">Popular</span>' : ""}
          <h2 style="margin:0 0 8px;font-size:18px">${esc(p.name)}</h2>
          <div class="price">${esc(p.priceLabel)}<span>/mo</span></div>
          <p class="subtitle">${esc(p.subtitle)}</p>
          <p class="muted" style="font-size:13px;margin-bottom:16px">${p.messagesPerMonth < 0 ? "Custom volume" : p.messagesPerMonth.toLocaleString() + " AI messages"}</p>
          ${usage.plan.id === p.id ? '<span class="pill active">Current plan</span>' : `<button class="btn ${p.popular?"btn-primary":""} btn-sm upgrade-btn" data-plan="${p.id}">Upgrade</button>`}
        </div>`).join("");
      v.innerHTML = `<div class="panel"><h3>💳 Your plan</h3>
        <p>Current: <b>${esc(usage.plan.name)}</b> — ${usage.aiReplies} / ${usage.limit < 0 ? "∞" : usage.limit} AI messages used</p>
        <div class="usage-bar"><div class="usage-bar-fill" style="width:${usage.limit > 0 ? Math.min(100, Math.round((usage.aiReplies/usage.limit)*100)) : 0}%"></div></div>
      </div>
      <div class="panel"><h3>Upgrade</h3>${planCards}
        <p class="muted" style="margin-top:12px">Pay with bKash, Nagad, or SSLCommerz (Bangladesh)</p>
        <div id="payBox" class="hidden panel" style="margin-top:12px"></div>
      </div>`;
      v.querySelectorAll(".upgrade-btn").forEach((btn) => btn.addEventListener("click", () => {
        const plan = btn.dataset.plan;
        const box = $("#payBox");
        box.classList.remove("hidden");
        box.innerHTML = `<p>Pay for <b>${plan}</b> plan:</p>
          <div class="actions">
          <button class="btn btn-sm pay-gw" data-gw="bkash">bKash</button>
          <button class="btn btn-sm pay-gw" data-gw="nagad">Nagad</button>
          <button class="btn btn-sm pay-gw" data-gw="sslcommerz">SSLCommerz</button></div>
          <p id="payResult" class="muted" style="margin-top:10px"></p>`;
        box.querySelectorAll(".pay-gw").forEach((g) => g.addEventListener("click", async () => {
          try {
            const r = await api("/billing/subscribe", { method: "POST", body: JSON.stringify({ plan, gateway: g.dataset.gw }) });
            if (r.redirectUrl) window.open(r.redirectUrl, "_blank");
            $("#payResult").textContent = r.instructions;
            toast("Payment initiated", "ok");
          } catch (e) { toast(e.message, "err"); }
        }));
      }));
    } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function renderPosts(v) {
    v.innerHTML = `<div class="panel"><h3>Create Post</h3>
      <div class="row"><input class="inp grow" id="topic" placeholder="Topic for AI…" /><button class="btn btn-primary" id="genBtn">🤖 Generate</button></div>
      <textarea class="inp" id="postText" style="min-height:120px;margin-top:12px"></textarea>
      <div class="row" style="margin-top:8px"><input class="inp" id="schedAt" type="datetime-local" /><input class="inp" id="postTitle" placeholder="Title (optional)" /></div>
      <div class="actions" style="margin-top:12px"><button class="btn btn-success" id="publishNow">Publish</button>
      <button class="btn" id="saveDraft">Save draft</button><button class="btn" id="schedulePost">Schedule</button></div></div>
      <div class="panel"><h3>📋 Templates</h3><div id="tplList"></div>
      <div class="row" style="margin-top:8px"><input class="inp grow" id="tplName" placeholder="Template name" />
      <button class="btn btn-primary btn-sm" id="saveTpl">Save as template</button></div></div>
      <div class="panel"><h3>Recent</h3><div id="postList"></div></div>`;
    $("#genBtn").addEventListener("click", async () => {
      const r = await api("/posts/generate", { method: "POST", body: JSON.stringify({ topic: $("#topic").value }) });
      $("#postText").value = r.text;
    });
    $("#saveDraft").addEventListener("click", async () => {
      await api("/posts", { method: "POST", body: JSON.stringify({ message: $("#postText").value }) });
      toast("Saved", "ok"); loadPostList();
    });
    $("#publishNow").addEventListener("click", async () => {
      const p = await api("/posts", { method: "POST", body: JSON.stringify({ message: $("#postText").value, title: $("#postTitle").value }) });
      await api(`/posts/${p.id}/publish`, { method: "POST" });
      toast("Published ✓", "ok"); loadPostList();
    });
    $("#schedulePost").addEventListener("click", async () => {
      const at = $("#schedAt").value;
      if (!at) return toast("Pick schedule date/time", "err");
      await api("/posts", { method: "POST", body: JSON.stringify({ message: $("#postText").value, title: $("#postTitle").value, scheduled_at: at }) });
      toast("Scheduled ✓", "ok"); loadPostList();
    });
    $("#saveTpl").addEventListener("click", async () => {
      await api("/post-templates", { method: "POST", body: JSON.stringify({ name: $("#tplName").value, message: $("#postText").value }) });
      toast("Template saved", "ok"); loadTemplates();
    });
    loadTemplates();
    loadPostList();
  }

  async function loadTemplates() {
    const box = $("#tplList"); if (!box) return;
    const tpls = await api("/post-templates");
    box.innerHTML = tpls.length ? "" : `<div class="muted">No templates yet</div>`;
    tpls.forEach((t) => {
      const b = el("button", "btn btn-sm", t.name);
      b.addEventListener("click", () => { $("#postText").value = t.message; $("#tplName").value = t.name; });
      box.appendChild(b);
    });
  }

  async function loadPostList() {
    const box = $("#postList"); if (!box) return;
    const posts = await api("/posts");
    box.innerHTML = posts.length ? "" : `<div class="empty">No posts.</div>`;
    posts.forEach((p) => {
      const item = el("div", "item");
      item.innerHTML = `<span class="pill ${p.status}">${p.status}</span><div class="msg">${esc(p.message).slice(0,200)}</div>`;
      box.appendChild(item);
    });
  }

  // ---- Admin views ----
  async function renderAdminDashboard(v) {
    const [k, s] = await Promise.all([api("/admin/kpis"), api("/admin/stats")]);
    const b = k.business || {};
    const u = k.usage || {};
    const r = k.revenue || {};
    const o = k.operations || {};
    const ad = b.channelAdoption || {};
    const totalV = b.totalVendors || 1;
    const topRows = (s.topVendors || []).map((vd) => {
      const ch = vd.channels || {};
      const dots = [ch.messenger?"MSG✓":"MSG✗", ch.whatsapp?"WA✓":"WA✗", ch.instagram?"IG✓":"IG✗"].join(" · ");
      return `<tr><td>${esc(vd.name)}</td><td><span class="pill">${esc(vd.plan)}</span></td>
        <td>${vd.aiReplies}</td><td>${vd.messagesIn}</td><td class="muted">${dots}</td></tr>`;
    }).join("") || `<tr><td colspan="5" class="muted">No vendor usage yet</td></tr>`;
    v.innerHTML = `${exportBar("/admin")}
    <div class="panel"><div class="kpi-section"><h3>🏢 Business · ${esc(k.month)}</h3>
    <div class="kpi-grid">
      ${kpiCard(b.totalVendors, "Total vendors", `${b.newVendorsThisMonth} new this month`)}
      ${kpiCard(b.activeVendors, "Active", `${b.trialVendors} trial`)}
      ${kpiCard(b.suspendedVendors, "Suspended", "")}
      ${kpiCard(`৳${fmtNum(r.mrrEstimate)}`, "MRR estimate", "Pro + Elite plans")}
    </div>
    <h4 style="margin:14px 0 6px;font-size:12px;color:var(--text-tertiary)">Plan distribution</h4>
    <div class="kpi-grid">
      ${kpiCard(b.byPlan?.trial||0, "Trial", "")}${kpiCard(b.byPlan?.pro||0, "Pro", "")}
      ${kpiCard(b.byPlan?.elite||0, "Elite", "")}${kpiCard(b.byPlan?.enterprise||0, "Enterprise", "")}
    </div></div></div>
    <div class="panel"><div class="kpi-section"><h3>📈 Platform usage & AI tokens</h3>
    <div class="kpi-grid">
      ${kpiCard(fmtNum(u.aiRepliesThisMonth), "AI replies", fmtDelta(u.aiRepliesDeltaPct))}
      ${kpiCard(fmtNum(u.messagesInThisMonth), "Messages in", "")}
      ${kpiCard(fmtNum(u.messagesOutThisMonth), "Messages out", "")}
      ${kpiCard(fmtNum(u.tokensInThisMonth + u.tokensOutThisMonth), "LLM tokens", `~${u.avgTokensPerReply}/reply`)}
    </div>
    <div class="kpi-grid" style="margin-top:10px">
      ${kpiCard(fmtCost(u.aiCostUsdThisMonth), "Est. AI cost", "All vendors")}
      ${kpiCard(fmtNum(u.totalConversations), "Conversations", "")}
      ${kpiCard(fmtNum(u.totalMessages), "Messages", "")}
      ${kpiCard(`${u.conversationsByChannel?.whatsapp||0}+${u.conversationsByChannel?.instagram||0}`, "WA+IG chats", `MSG ${u.conversationsByChannel?.messenger||0}`)}
    </div>
    <div class="chart-canvas-wrap" style="margin-top:12px"><canvas id="adminDashAiLine"></canvas></div>
    </div></div>
    <div class="panel"><div class="kpi-section"><h3>💳 Revenue & operations</h3>
    <div class="kpi-grid">
      ${kpiCard(`৳${fmtNum(r.revenueBdtThisMonth)}`, "Revenue (BDT)", "Completed payments")}
      ${kpiCard(r.completedPaymentsThisMonth, "Payments done", `${r.pendingPayments} pending`)}
      ${kpiCard(o.totalOrders, "Orders", `${o.pendingOrders} pending`)}
      ${kpiCard(o.handoffQueue, "Handoff queue", `${o.pendingComments} comments`)}
    </div>
    <div class="status-row" style="margin-top:14px">
      <span class="status-chip ${s.aiConfigured?"ok":"warn"}">AI ${s.aiConfigured?"configured":"not set"}</span>
      <span class="status-chip ${s.payments?.bkash?"ok":"off"}">bKash</span>
      <span class="status-chip ${s.payments?.nagad?"ok":"off"}">Nagad</span>
      <span class="status-chip ${s.payments?.sslcommerz?"ok":"off"}">SSLCommerz</span>
    </div>
    ${r.pendingPayments > 0 ? `<p class="muted" style="margin-top:10px"><a href="#" data-goto="admin-billing" class="link-neon">Confirm ${r.pendingPayments} pending payment(s) →</a></p>` : ""}
    </div></div>
    <div class="panel"><div class="kpi-section"><h3>📡 Channel adoption</h3>
    ${adoptionBar("Messenger", ad.messenger?.pct||0, ad.messenger?.connected||0, totalV)}
    ${adoptionBar("WhatsApp", ad.whatsapp?.pct||0, ad.whatsapp?.connected||0, totalV)}
    ${adoptionBar("Instagram", ad.instagram?.pct||0, ad.instagram?.connected||0, totalV)}
    <p class="muted" style="margin-top:10px;font-size:12px"><a href="#" data-goto="admin-ai" class="link-neon">Configure AI + Meta OAuth →</a></p>
    </div></div>
    <div class="panel"><h3>Top vendors by AI usage</h3>
    <table class="data-table"><thead><tr><th>Vendor</th><th>Plan</th><th>AI</th><th>In</th><th>Channels</th></tr></thead><tbody>${topRows}</tbody></table></div>
    <p class="muted" style="margin-top:8px"><a href="#" data-goto="admin-analytics" class="link-neon">Open full Platform Analytics →</a></p>`;
    bindExportBar(v, "/admin");
    v.querySelectorAll("[data-goto]").forEach((lnk) => lnk.addEventListener("click", (e) => {
      e.preventDefault(); currentView = lnk.dataset.goto; showApp();
    }));
    window.KpiCharts?.line("adminDashAiLine", dayLabels(u.dailyAi), [
      { label: "AI calls", data: (u.dailyAi || []).map((d) => d.calls), color: "#00e5ff" },
    ]);
  }

  async function renderAdminAnalytics(v) {
    try {
      const k = await api("/admin/kpis");
      const b = k.business || {};
      const u = k.usage || {};
      const r = k.revenue || {};
      const ad = b.channelAdoption || {};
      v.innerHTML = `${exportBar("/admin")}
      <div class="panel"><h3>Platform Analytics · ${esc(k.month)}</h3>
      <p class="section-hint">Cross-vendor metrics, token costs, channel adoption, and exportable reports.</p>
      <div class="kpi-grid" style="margin-top:12px">
        ${kpiCard(fmtNum(u.aiRepliesThisMonth), "AI replies", fmtDelta(u.aiRepliesDeltaPct))}
        ${kpiCard(fmtCost(u.aiCostUsdThisMonth), "AI cost", "All vendors")}
        ${kpiCard(b.totalVendors, "Vendors", `${b.activeVendors} active`)}
        ${kpiCard(`৳${fmtNum(r.revenueBdtThisMonth)}`, "Revenue BDT", `${r.pendingPayments} pending pay`)}
      </div>
      <div class="chart-grid">
        <div class="chart-box"><h4>Platform AI calls (7d)</h4><div class="chart-canvas-wrap"><canvas id="admAiLine"></canvas></div></div>
        <div class="chart-box"><h4>LLM tokens (7d)</h4><div class="chart-canvas-wrap"><canvas id="admTokenLine"></canvas></div></div>
        <div class="chart-box"><h4>Messages in / out (7d)</h4><div class="chart-canvas-wrap"><canvas id="admMsgLine"></canvas></div></div>
        <div class="chart-box"><h4>AI cost USD (7d)</h4><div class="chart-canvas-wrap"><canvas id="admCostLine"></canvas></div></div>
        <div class="chart-box"><h4>Conversations by channel</h4><div class="chart-canvas-wrap"><canvas id="admChBar"></canvas></div></div>
        <div class="chart-box"><h4>Vendors by plan</h4><div class="chart-canvas-wrap"><canvas id="admPlanDonut"></canvas></div></div>
        <div class="chart-box"><h4>Channel adoption %</h4><div class="chart-canvas-wrap"><canvas id="admAdoptBar"></canvas></div></div>
      </div></div>`;
      bindExportBar(v, "/admin");
      const dl = dayLabels(u.dailyAi);
      const de = dayLabels(u.dailyEngagement);
      const ch = u.conversationsByChannel || {};
      const KC = window.KpiCharts;
      KC?.line("admAiLine", dl, [{ label: "Calls", data: (u.dailyAi || []).map((d) => d.calls), color: "#00e5ff" }]);
      KC?.line("admTokenLine", dl, [
        { label: "In", data: (u.dailyAi || []).map((d) => d.tokensIn), color: "#a78bfa" },
        { label: "Out", data: (u.dailyAi || []).map((d) => d.tokensOut), color: "#34d399" },
      ]);
      KC?.line("admMsgLine", de, [
        { label: "In", data: (u.dailyEngagement || []).map((d) => d.messagesIn), color: "#38bdf8" },
        { label: "Out", data: (u.dailyEngagement || []).map((d) => d.messagesOut), color: "#fb923c" },
      ]);
      KC?.line("admCostLine", dl, [{ label: "USD", data: (u.dailyAi || []).map((d) => d.costUsd), color: "#fbbf24" }]);
      KC?.bar("admChBar", ["Messenger", "WhatsApp", "Instagram"],
        [ch.messenger||0, ch.whatsapp||0, ch.instagram||0], "Conversations", "#00e5ff");
      KC?.doughnut("admPlanDonut", ["Trial", "Pro", "Elite", "Enterprise"],
        [b.byPlan?.trial||0, b.byPlan?.pro||0, b.byPlan?.elite||0, b.byPlan?.enterprise||0],
        ["#64748b", "#00e5ff", "#a78bfa", "#34d399"]);
      KC?.bar("admAdoptBar", ["Messenger", "WhatsApp", "Instagram"],
        [ad.messenger?.pct||0, ad.whatsapp?.pct||0, ad.instagram?.pct||0], "Adoption %", "#38bdf8");
    } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  async function renderAdminBilling(v) {
    const payments = await api("/admin/payments");
    v.innerHTML = `<div class="panel"><h3>Payment queue</h3>
    <p class="section-hint">Confirm manual bKash/Nagad payments after verifying transaction ID.</p>
    <div id="payQueue"></div></div>`;
    const box = $("#payQueue");
    const pending = payments.filter((p) => p.status === "pending");
    if (!pending.length) {
      box.innerHTML = `<div class="empty">No pending payments.</div>`;
      return;
    }
    pending.forEach((p) => {
      const row = el("div", "order-item");
      row.innerHTML = `<div class="head"><span class="who">#${p.id} · ${esc(p.gateway)}</span><span class="pill pending">pending</span></div>
        <div class="msg muted">Vendor #${p.vendor_id} · ${esc(p.plan)} · ৳${p.amount}</div>
        <div class="msg">Txn: ${esc(p.transaction_id || "—")} · ${esc(p.created_at || "")}</div>
        <div class="actions"><button class="btn btn-success btn-sm" data-confirm="${p.id}">Confirm & activate plan</button></div>`;
      row.querySelector("[data-confirm]").addEventListener("click", async () => {
        await api(`/admin/payments/${p.id}/confirm`, { method: "POST" });
        toast("Payment confirmed ✓", "ok"); renderAdminBilling(v);
      });
      box.appendChild(row);
    });
  }

  function renderPaymentFields(fields, vals) {
    return fields.map((f) => {
      const val = vals[f.key] ?? "";
      if (f.type === "select") {
        return `<label class="field">${f.label}</label><select class="inp pk" data-key="${f.key}">${f.options.map((o) => `<option value="${o.v}" ${String(val)===o.v?"selected":""}>${o.l}</option>`).join("")}</select>`;
      }
      if (f.type === "textarea") {
        return `<div><label class="field">${f.label}</label><textarea class="inp pk" data-key="${f.key}" ${f.secret?"data-secret=1":""} style="min-height:72px;font-family:ui-monospace,monospace;font-size:12px">${esc(val)}</textarea></div>`;
      }
      return `<div><label class="field">${f.label}</label><input class="inp pk" data-key="${f.key}" ${f.secret?"data-secret=1":""} type="${f.type}" value="${esc(val)}" placeholder="${esc(f.placeholder||"")}" /></div>`;
    }).join("");
  }

  const PAYMENT_SECTIONS = [
    { title: "bKash Merchant API", hint: "Credentials from bKash Merchant API portal.", open: true, fields: [
      { key: "BKASH_APP_KEY", label: "App Key", type: "text" },
      { key: "BKASH_APP_SECRET", label: "App Secret", type: "password", secret: true },
      { key: "BKASH_USERNAME", label: "Username", type: "text" },
      { key: "BKASH_PASSWORD", label: "Password", type: "password", secret: true },
      { key: "BKASH_MERCHANT_NUMBER", label: "Merchant bKash number", type: "text", placeholder: "01XXXXXXXXX" },
      { key: "BKASH_SANDBOX", label: "Sandbox mode", type: "select", options: [{v:"true",l:"true (sandbox)"},{v:"false",l:"false (live)"}] },
    ]},
    { title: "Nagad Merchant API", hint: "Credentials from Nagad Merchant Integration.", fields: [
      { key: "NAGAD_MERCHANT_ID", label: "Merchant ID", type: "text" },
      { key: "NAGAD_MERCHANT_NUMBER", label: "Merchant Nagad number", type: "text" },
      { key: "NAGAD_PUBLIC_KEY", label: "Public key", type: "textarea" },
      { key: "NAGAD_PRIVATE_KEY", label: "Private key", type: "textarea", secret: true },
      { key: "NAGAD_SANDBOX", label: "Sandbox mode", type: "select", options: [{v:"true",l:"true (sandbox)"},{v:"false",l:"false (live)"}] },
    ]},
    { title: "SSLCommerz", hint: "Store ID and password from SSLCommerz merchant panel.", fields: [
      { key: "SSLCOMMERZ_STORE_ID", label: "Store ID", type: "text" },
      { key: "SSLCOMMERZ_STORE_PASS", label: "Store Password", type: "password", secret: true },
      { key: "SSLCOMMERZ_SANDBOX", label: "Sandbox mode", type: "select", options: [{v:"true",l:"true (sandbox)"},{v:"false",l:"false (live)"}] },
    ]},
    { title: "Sales contact", hint: "Displayed on pricing page for Enterprise inquiries.", fields: [
      { key: "SALES_EMAIL", label: "Sales email", type: "email" },
      { key: "SALES_WHATSAPP", label: "Sales WhatsApp", type: "text", placeholder: "8801XXXXXXXXX" },
    ]},
  ];

  async function renderAdminPayments(v) {
    const cfg = await api("/admin/platform/payments");
    const vals = cfg.values || {};
    const status = cfg.configured || {};
    const chip = (on, label) => `<span class="status-chip ${on?"ok":"off"}">${label}</span>`;
    const sections = PAYMENT_SECTIONS.map((s) => `
      <details class="config-section" ${s.open?"open":""}>
        <summary>${esc(s.title)}</summary>
        <div class="config-body">
          <p class="section-hint">${esc(s.hint)}</p>
          <div class="form-grid">${renderPaymentFields(s.fields, vals)}</div>
        </div>
      </details>`).join("");
    v.innerHTML = `<div class="panel">
      <h3>Payment configuration</h3>
      <p class="section-hint">One payment setup for all vendors. Credentials are platform-wide and never shown to vendors.</p>
      <div class="status-row">${chip(status.bkash,"bKash connected")}${chip(status.nagad,"Nagad connected")}${chip(status.sslcommerz,"SSLCommerz connected")}</div>
    </div>
    ${sections}
    <div class="actions"><button class="btn btn-primary" id="savePay">Save payment config</button></div>`;
    $("#savePay").addEventListener("click", async () => {
      const values = {};
      v.querySelectorAll(".pk").forEach((n) => {
        if (n.getAttribute("data-secret")==="1" && (n.value===""||n.value.startsWith("••••"))) return;
        values[n.getAttribute("data-key")] = n.value;
      });
      const r = await api("/admin/platform/payments", { method: "PUT", body: JSON.stringify({ values }) });
      toast("Payment config saved ✓", "ok");
      if (r.configured) renderAdminPayments(v);
    });
  }

  const AI_FIELDS = [
    { key: "AI_PROVIDER", label: "Provider", type: "select", options: ["gemini", "groq", "anthropic"] },
    { key: "GEMINI_API_KEY", label: "Gemini API key", type: "password", secret: true },
    { key: "GEMINI_MODEL", label: "Gemini model", type: "text" },
    { key: "GROQ_API_KEY", label: "Groq API key", type: "password", secret: true },
    { key: "GROQ_MODEL", label: "Groq model", type: "text" },
    { key: "ANTHROPIC_API_KEY", label: "Claude API key", type: "password", secret: true },
    { key: "ANTHROPIC_MODEL", label: "Claude model", type: "text" },
  ];

  async function renderAdminAi(v) {
    const [cfg, meta] = await Promise.all([
      api("/admin/platform/ai"),
      api("/admin/platform/meta"),
    ]);
    const vals = cfg.values || {};
    const mvals = meta.values || {};
    const fields = AI_FIELDS.map((f) => {
      const val = vals[f.key] ?? "";
      if (f.type === "select") return `<label class="field">${f.label}</label><select class="inp ak" data-key="${f.key}">${f.options.map((o) => `<option ${o===val?"selected":""}>${o}</option>`).join("")}</select>`;
      return `<label class="field">${f.label}</label><input class="inp ak" data-key="${f.key}" ${f.secret?"data-secret=1":""} type="${f.type}" value="${esc(val)}" />`;
    }).join("");
    v.innerHTML = `<div class="panel"><h3>AI configuration</h3>
      <p class="section-hint">One AI provider for all vendors. Token usage & cost tracked on Platform dashboard.</p>${fields}
      <div class="actions" style="margin-top:14px"><button class="btn btn-primary" id="saveAi">Save AI config</button></div></div>
      <div class="panel"><h3>Meta OAuth (Facebook + Instagram connect)</h3>
      <p class="section-hint">Enables vendors to connect Messenger, Instagram, and WhatsApp via OAuth. Add scopes: whatsapp_business_management, whatsapp_business_messaging. Redirect URI in Meta Developer → Facebook Login:</p>
      <div class="webhook-box"><code>${esc(meta.redirectUri || "")}</code></div>
      <div class="status-row" style="margin:12px 0"><span class="status-chip ${meta.configured?"ok":"warn"}">Meta App ${meta.configured?"configured":"not set"}</span></div>
      <label class="field">Meta App ID</label><input class="inp mk" data-key="META_APP_ID" value="${esc(mvals.META_APP_ID||"")}" />
      <label class="field">Meta App Secret</label><input class="inp mk" data-key="META_APP_SECRET" data-secret=1 type="password" value="${esc(mvals.META_APP_SECRET||"")}" />
      <div class="actions" style="margin-top:14px"><button class="btn btn-primary" id="saveMeta">Save Meta config</button></div></div>`;
    $("#saveAi").addEventListener("click", async () => {
      const values = {};
      v.querySelectorAll(".ak").forEach((n) => {
        if (n.getAttribute("data-secret")==="1" && (n.value===""||n.value.startsWith("••••"))) return;
        values[n.getAttribute("data-key")] = n.value;
      });
      await api("/admin/platform/ai", { method: "PUT", body: JSON.stringify({ values }) });
      toast("AI config saved ✓", "ok");
    });
    $("#saveMeta").addEventListener("click", async () => {
      const values = {};
      v.querySelectorAll(".mk").forEach((n) => {
        if (n.getAttribute("data-secret")==="1" && (n.value===""||n.value.startsWith("••••"))) return;
        values[n.getAttribute("data-key")] = n.value;
      });
      await api("/admin/platform/meta", { method: "PUT", body: JSON.stringify({ values }) });
      toast("Meta config saved ✓", "ok"); renderAdminAi(v);
    });
  }

  async function renderAdminVendors(v) {
    const vendors = await api("/admin/vendors");
    v.innerHTML = `<div class="panel"><h3>➕ Create New Vendor</h3>
      <div class="row"><input class="inp grow" id="nvName" placeholder="Business name" />
      <input class="inp grow" id="nvOwner" placeholder="Owner name" /></div>
      <div class="row"><input class="inp grow" id="nvEmail" placeholder="Email" />
      <input class="inp grow" id="nvPass" type="password" placeholder="Password" /></div>
      <button class="btn btn-primary" id="createVendor">Create Vendor</button></div>
      <div class="panel"><h3>All Vendors (${vendors.length})</h3>
      <p class="muted">Vendors self-configure channels & knowledge. Use <b>Manage</b> to override or reset password.</p></div>`;
    $("#createVendor").addEventListener("click", async () => {
      try {
        await api("/admin/vendors", { method: "POST", body: JSON.stringify({
          businessName: $("#nvName").value, ownerName: $("#nvOwner").value,
          email: $("#nvEmail").value, password: $("#nvPass").value,
        })});
        toast("Vendor created ✓ — now click Manage to configure", "ok");
        render();
      } catch (e) { toast(e.message, "err"); }
    });
    vendors.forEach((vd) => {
      const card = el("div", "vendor-card");
      const ch = vd.channels || {};
      const chStr = `${ch.messenger?"MSG✓":"MSG✗"} ${ch.whatsapp?"WA✓":"WA✗"} ${ch.instagram?"IG✓":"IG✗"}`;
      card.innerHTML = `<div class="head"><div><strong>${esc(vd.name)}</strong>
        <div class="muted">${esc(vd.email)} · Page: ${esc(vd.fb_page_id || "not set")}</div></div>
        <span class="pill ${vd.status}">${vd.status}</span></div>
        <div class="muted" style="margin-top:6px;font-size:13px">💬 ${vd.conversations} · 📝 ${vd.posts} posts · AI ${vd.ai_replies_month||0}/mo · ${chStr}</div>
        <div class="actions"></div>`;
      const actions = card.querySelector(".actions");
      const manage = el("button", "btn btn-primary btn-sm", "Manage");
      manage.addEventListener("click", () => {
        manageVendorId = vd.id;
        currentView = "admin-manage";
        document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === "admin-manage"));
        $("#viewTitle").textContent = "Manage Vendor";
        render();
      });
      actions.appendChild(manage);
      const planSel = el("select", "inp");
      planSel.style.maxWidth = "120px";
      ["trial","pro","elite","enterprise"].forEach((p) => {
        const o = el("option"); o.value = p; o.textContent = p;
        if (vd.plan === p) o.selected = true; planSel.appendChild(o);
      });
      planSel.addEventListener("change", async () => {
        await api(`/admin/vendors/${vd.id}/plan`, { method: "PATCH", body: JSON.stringify({ plan: planSel.value }) });
        toast("Plan updated", "ok");
      });
      actions.appendChild(planSel);
      if (vd.status !== "suspended") {
        const suspend = el("button", "btn btn-danger btn-sm", "Suspend");
        suspend.addEventListener("click", async () => {
          await api(`/admin/vendors/${vd.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "suspended" }) });
          render(); toast("Suspended", "ok");
        });
        actions.appendChild(suspend);
      } else {
        const activate = el("button", "btn btn-success btn-sm", "Activate");
        activate.addEventListener("click", async () => {
          await api(`/admin/vendors/${vd.id}/status`, { method: "PATCH", body: JSON.stringify({ status: "active" }) });
          render(); toast("Activated", "ok");
        });
        actions.appendChild(activate);
      }
      v.appendChild(card);
    });
  }

  async function renderAdminManage(v) {
    const vendors = await api("/admin/vendors");
    const sel = vendors.map((vd) => `<option value="${vd.id}" ${manageVendorId==vd.id?"selected":""}>${esc(vd.name)}</option>`).join("");
    v.innerHTML = `<div class="panel"><label class="field">Select vendor</label>
      <select class="inp" id="pickVendor">${sel}</select></div>
      <div id="manageBody"><div class="empty">Select a vendor above</div></div>`;
    const load = async (id) => {
      manageVendorId = Number(id);
      const [cfg, kb] = await Promise.all([
        api(`/admin/vendors/${id}/config`),
        api(`/admin/vendors/${id}/knowledge`),
      ]);
      const vals = cfg.values || {};
      const body = $("#manageBody");
      body.innerHTML = `<div class="panel"><h3>📘 Facebook Page — ${esc(cfg.vendor.name)}</h3>
        <label class="field">Page ID</label><input class="inp vk" data-key="FB_PAGE_ID" value="${esc(vals.FB_PAGE_ID||"")}" />
        <label class="field">Page Access Token</label><input class="inp vk" data-key="FB_PAGE_ACCESS_TOKEN" data-secret=1 type="password" value="${esc(vals.FB_PAGE_ACCESS_TOKEN||"")}" />
        <label class="field">Graph API version</label><input class="inp vk" data-key="FB_GRAPH_VERSION" value="${esc(vals.FB_GRAPH_VERSION||"v21.0")}" />
        <h4 style="margin-top:16px">📱 WhatsApp</h4>
        <label class="field">Phone Number ID</label><input class="inp vk" data-key="WA_PHONE_NUMBER_ID" value="${esc(vals.WA_PHONE_NUMBER_ID||"")}" />
        <label class="field">WhatsApp Access Token</label><input class="inp vk" data-key="WA_ACCESS_TOKEN" data-secret=1 type="password" value="${esc(vals.WA_ACCESS_TOKEN||"")}" />
        <h4 style="margin-top:16px">📸 Instagram</h4>
        <label class="field">Instagram Account ID</label><input class="inp vk" data-key="IG_ACCOUNT_ID" value="${esc(vals.IG_ACCOUNT_ID||"")}" />
        <p class="muted" style="font-size:12px">Webhook URLs: /webhook (Messenger+FB), /webhook/whatsapp, /webhook/instagram</p>
        <label class="field">Auto-reply messages</label><select class="inp vk" data-key="AUTO_REPLY_MESSAGES"><option value="false" ${vals.AUTO_REPLY_MESSAGES==="false"?"selected":""}>false</option><option value="true" ${vals.AUTO_REPLY_MESSAGES==="true"?"selected":""}>true</option></select>
        <label class="field">Auto-reply comments</label><select class="inp vk" data-key="AUTO_REPLY_COMMENTS"><option value="false" ${vals.AUTO_REPLY_COMMENTS==="false"?"selected":""}>false</option><option value="true" ${vals.AUTO_REPLY_COMMENTS==="true"?"selected":""}>true</option></select>
        <label class="field">Reply language</label><select class="inp vk" data-key="REPLY_LANGUAGE">${["banglish","bangla","english","auto"].map((l)=>`<option ${vals.REPLY_LANGUAGE===l?"selected":""}>${l}</option>`).join("")}</select>
        <div class="actions"><button class="btn btn-primary" id="saveVk">💾 Save vendor config</button></div></div>
        <div class="panel"><h3>🔑 Reset vendor password</h3>
        <div class="row"><input class="inp grow" id="resetPass" type="password" placeholder="New password (min 6 chars)" />
        <button class="btn btn-sm" id="doResetPass">Reset password</button></div></div>
        <div class="panel"><h3>🧠 Knowledge Base</h3>
        <textarea class="inp" id="vkKb" style="min-height:40vh;font-family:monospace;font-size:13px">${esc(kb.content)}</textarea>
        <div class="actions"><button class="btn btn-primary" id="saveKb">💾 Save knowledge</button></div></div>
        <div class="panel" id="productsPanel"><h3>🛍️ Product Catalog</h3>
        <p class="muted">AI can send product photos in Messenger when customers ask. Set <code>PUBLIC_BASE_URL</code> to your HTTPS tunnel URL.</p>
        <div id="productList"></div>
        <h4 style="margin-top:16px">Add product</h4>
        <div class="row"><input class="inp grow" id="pName" placeholder="Product name" />
        <input class="inp" id="pPrice" placeholder="Price e.g. ৳500" style="max-width:140px" /></div>
        <textarea class="inp" id="pDesc" placeholder="Description" style="min-height:60px;margin-top:8px"></textarea>
        <div class="row" style="margin-top:8px"><input class="inp grow" id="pLink" placeholder="Product link (optional)" />
        <input class="inp" id="pImage" type="file" accept="image/*" style="max-width:220px" /></div>
        <div class="actions"><button class="btn btn-primary" id="addProduct">➕ Add product</button></div></div>
        <div class="panel" id="ordersPanel"><h3>🛒 Orders</h3>
        <div class="actions" style="margin-top:0;margin-bottom:12px">
        <button class="btn btn-primary btn-sm" id="adminExportOrders">📥 Export Excel</button></div>
        <div id="adminOrderList"></div></div>`;
      const renderAdminOrders = async () => {
        const orders = await api(`/admin/vendors/${id}/orders`);
        const box = $("#adminOrderList");
        if (!orders.length) { box.innerHTML = `<div class="empty" style="padding:16px">No orders yet.</div>`; return; }
        box.innerHTML = "";
        orders.slice(0, 20).forEach((o) => {
          const row = el("div", "order-item");
          const itemsText = (o.items || []).map((i) => `${i.name} ×${i.qty}`).join(", ");
          row.innerHTML = `<div class="head"><span class="who">${esc(o.order_number)}</span><span class="pill ${o.status}">${o.status}</span></div>
            <div class="msg muted">${esc(o.customer_name || "")} · ${esc(o.customer_phone || "")}</div>
            <div class="msg">${esc(itemsText)} · <strong>${esc(o.total || "")}</strong></div>`;
          box.appendChild(row);
        });
      };
      $("#adminExportOrders").addEventListener("click", async () => {
        try {
          await downloadCsv(`/admin/vendors/${id}/orders/export`, `orders-vendor-${id}.csv`);
          toast("Exported ✓", "ok");
        } catch (e) { toast(e.message, "err"); }
      });
      const renderProducts = async () => {
        const products = await api(`/admin/vendors/${id}/products`);
        const box = $("#productList");
        if (!products.length) { box.innerHTML = `<div class="empty" style="padding:20px">No products yet.</div>`; return; }
        box.innerHTML = "";
        products.forEach((p) => {
          const card = el("div", "product-card");
          card.innerHTML = `${p.image_url ? `<img class="product-thumb" src="${esc(p.image_url)}" alt="" />` : `<div class="product-thumb empty-thumb">📷</div>`}
            <div class="product-info"><strong>${esc(p.name)}</strong> ${p.active ? "" : '<span class="pill ignored">inactive</span>'}
            <div class="muted">${esc(p.price || "")} ${p.description ? "· " + esc(p.description).slice(0,60) : ""}</div></div>`;
          const actions = el("div", "actions");
          const del = el("button", "btn btn-danger btn-sm", "Delete");
          del.addEventListener("click", async () => {
            await api(`/admin/vendors/${id}/products/${p.id}`, { method: "DELETE" });
            renderProducts(); toast("Deleted", "ok");
          });
          actions.appendChild(del);
          card.appendChild(actions);
          box.appendChild(card);
        });
      };
      renderProducts();
      renderAdminOrders();
      $("#addProduct").addEventListener("click", async () => {
        const name = $("#pName").value.trim();
        if (!name) return toast("Product name required", "err");
        const fd = new FormData();
        fd.append("name", name);
        fd.append("price", $("#pPrice").value);
        fd.append("description", $("#pDesc").value);
        fd.append("link", $("#pLink").value);
        const file = $("#pImage").files[0];
        if (file) fd.append("image", file);
        try {
          await apiForm(`/admin/vendors/${id}/products`, fd);
          $("#pName").value = ""; $("#pPrice").value = ""; $("#pDesc").value = "";
          $("#pLink").value = ""; $("#pImage").value = "";
          renderProducts(); toast("Product added ✓", "ok");
        } catch (e) { toast(e.message, "err"); }
      });
      $("#saveVk").addEventListener("click", async () => {
        const values = {};
        body.querySelectorAll(".vk").forEach((n) => {
          if (n.getAttribute("data-secret")==="1" && (n.value===""||n.value.startsWith("••••"))) return;
          values[n.getAttribute("data-key")] = n.value;
        });
        await api(`/admin/vendors/${id}/config`, { method: "PUT", body: JSON.stringify({ values }) });
        toast("Vendor config saved ✓", "ok");
      });
      $("#saveKb").addEventListener("click", async () => {
        await api(`/admin/vendors/${id}/knowledge`, { method: "PUT", body: JSON.stringify({ content: $("#vkKb").value }) });
        toast("Knowledge saved ✓", "ok");
      });
      $("#doResetPass").addEventListener("click", async () => {
        const password = $("#resetPass").value;
        if (password.length < 6) return toast("Password min 6 chars", "err");
        await api(`/admin/vendors/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) });
        $("#resetPass").value = "";
        toast("Password reset ✓", "ok");
      });
    };
    $("#pickVendor").addEventListener("change", (e) => load(e.target.value));
    if (manageVendorId) load(manageVendorId);
  }

  // Boot — keep session on transient /auth/me errors after Meta OAuth redirect
  if (token && user) {
    api("/auth/me")
      .then((r) => {
        saveSession(token, r.user, r.vendor);
        showApp();
      })
      .catch((err) => {
        const oauthReturn = new URLSearchParams(location.search).has("meta_oauth");
        if (oauthReturn && token) {
          showApp();
          toast(err.message || "Could not refresh session — sign in again if pages are missing", "err");
        } else logout();
      });
  }
})();
