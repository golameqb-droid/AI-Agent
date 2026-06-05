/* eQuestionBankBD AI Agent — Dashboard */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
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

  const AUTH_KEY = "eq_auth";
  let auth = localStorage.getItem(AUTH_KEY) || "";
  let currentView = "dashboard";
  let activeConv = null;

  // ---------------- API ----------------
  async function api(path, opts = {}) {
    const res = await fetch("/api" + path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + auth,
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401) {
      logout();
      throw new Error("Session expired. Please sign in again.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // ---------------- Toast ----------------
  let toastTimer;
  function toast(msg, type = "") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show " + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = "toast"), 3200);
  }

  // ---------------- Auth ----------------
  function showApp() {
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    refreshStatus();
    refreshBadges();
    render();
  }
  function logout() {
    auth = "";
    localStorage.removeItem(AUTH_KEY);
    $("#app").classList.add("hidden");
    $("#login").classList.remove("hidden");
  }

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = $("#loginUser").value.trim();
    const p = $("#loginPass").value;
    auth = btoa(u + ":" + p);
    try {
      await api("/status");
      localStorage.setItem(AUTH_KEY, auth);
      $("#loginError").textContent = "";
      showApp();
    } catch (err) {
      auth = "";
      $("#loginError").textContent = "Invalid username or password.";
    }
  });

  $("#logoutBtn").addEventListener("click", logout);
  $("#refreshBtn").addEventListener("click", () => {
    refreshStatus();
    refreshBadges();
    render();
  });

  // ---------------- Nav ----------------
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentView = btn.dataset.view;
      $("#viewTitle").textContent = btn.textContent.trim().replace(/\d+$/, "");
      render();
    });
  });

  // ---------------- Status & badges ----------------
  async function refreshStatus() {
    try {
      const s = await api("/status");
      const ai = s.ai.configured ? `AI: ${s.ai.provider} ✓` : "AI: not set ✗";
      const fb = s.facebook.configured ? "FB ✓" : "FB: not set ✗";
      $("#statusPill").textContent = `${ai} · ${fb}`;
    } catch {
      $("#statusPill").textContent = "offline";
    }
  }
  async function refreshBadges() {
    try {
      const a = await api("/analytics");
      setBadge("#badgeInbox", a.pendingMessages);
      setBadge("#badgeComments", a.pendingComments);
    } catch {}
  }
  function setBadge(sel, n) {
    const b = $(sel);
    if (n > 0) {
      b.textContent = n;
      b.classList.add("show");
    } else b.classList.remove("show");
  }

  // ---------------- Router ----------------
  function render() {
    const v = $("#view");
    v.innerHTML = "<div class='empty'>Loading…</div>";
    ({
      dashboard: renderDashboard,
      inbox: renderInbox,
      comments: renderComments,
      posts: renderPosts,
      knowledge: renderKnowledge,
      settings: renderSettings,
      config: renderConfig,
    }[currentView] || renderDashboard)(v);
  }

  // ---------------- Dashboard ----------------
  async function renderDashboard(v) {
    try {
      const a = await api("/analytics");
      const stat = (num, label) =>
        `<div class="card stat"><div class="num">${num}</div><div class="label">${label}</div></div>`;
      v.innerHTML = `
        <div class="cards">
          ${stat(a.conversations, "Conversations")}
          ${stat(a.pendingMessages, "Messages awaiting reply")}
          ${stat(a.pendingComments, "Comments awaiting reply")}
          ${stat(a.sentMessages, "Replies sent")}
          ${stat(a.sentComments, "Comments answered")}
          ${stat(a.publishedPosts, "Posts published")}
          ${stat(a.scheduledPosts, "Posts scheduled")}
          ${stat(a.drafts, "Post drafts")}
        </div>
        <div class="panel" style="margin-top:18px">
          <h3>Welcome 👋</h3>
          <p class="muted">This is your AI agent control center. Use <b>Inbox</b> to approve replies to Messenger,
          <b>Comments</b> to manage post comments, and <b>Create Post</b> to let AI write & schedule content.
          Fill in your business details under <b>Knowledge</b> so the AI answers accurately.</p>
        </div>`;
    } catch (e) {
      v.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }

  // ---------------- Inbox ----------------
  async function renderInbox(v) {
    let convos = [];
    try {
      convos = await api("/conversations");
    } catch (e) {
      v.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    v.innerHTML = `<div class="inbox">
      <div class="conv-list" id="convList"></div>
      <div class="chat" id="chat"><div class="empty">Select a conversation</div></div>
    </div>`;
    const list = $("#convList");
    if (!convos.length) {
      list.innerHTML = `<div class="empty">No conversations yet.<br/>They appear when people message your page.</div>`;
      return;
    }
    convos.forEach((c) => {
      const node = el("div", "conv" + (activeConv === c.id ? " active" : ""));
      node.innerHTML = `<div class="name">${esc(c.customer_name || "Customer")} ${
        c.unread > 0 ? '<span class="dot"></span>' : ""
      }</div><div class="prev">${esc(c.last_message || "")}</div>`;
      node.addEventListener("click", () => openConversation(c));
      list.appendChild(node);
    });
    if (activeConv) {
      const c = convos.find((x) => x.id === activeConv);
      if (c) openConversation(c);
    }
  }

  async function openConversation(c) {
    activeConv = c.id;
    document.querySelectorAll(".conv").forEach((n) => n.classList.remove("active"));
    const chat = $("#chat");
    chat.innerHTML = "<div class='empty'>Loading…</div>";
    let msgs = [];
    try {
      msgs = await api(`/conversations/${c.id}/messages`);
    } catch (e) {
      chat.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    chat.innerHTML = `<div class="chat-body" id="chatBody"></div>
      <div class="chat-foot">
        <textarea class="inp grow" id="replyBox" placeholder="Type a reply…"></textarea>
        <button class="btn btn-primary" id="sendBtn">Send</button>
      </div>`;
    const body = $("#chatBody");
    msgs.forEach((m) => {
      if (m.status === "pending" && m.direction === "out" && m.ai_draft) {
        const wrap = el("div", "bubble draft");
        wrap.innerHTML = `<div class="draft-tag">🤖 AI DRAFT · click to use</div>${esc(m.ai_draft)}`;
        wrap.style.cursor = "pointer";
        wrap.addEventListener("click", () => {
          $("#replyBox").value = m.ai_draft;
          $("#replyBox").focus();
        });
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
        await api(`/conversations/${c.id}/reply`, {
          method: "POST",
          body: JSON.stringify({ text }),
        });
        toast("Reply sent ✓", "ok");
        $("#replyBox").value = "";
        const fresh = await api("/conversations");
        const cc = fresh.find((x) => x.id === c.id) || c;
        openConversation(cc);
        refreshBadges();
      } catch (e) {
        toast(e.message, "err");
      }
    });
  }

  // ---------------- Comments ----------------
  async function renderComments(v) {
    let items = [];
    try {
      items = await api("/comments");
    } catch (e) {
      v.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    if (!items.length) {
      v.innerHTML = `<div class="empty">No comments yet.<br/>New comments on your posts will show here.</div>`;
      return;
    }
    v.innerHTML = "";
    items.forEach((c) => {
      const item = el("div", "item");
      item.innerHTML = `
        <div class="head">
          <span class="who">${esc(c.from_name || "Someone")}</span>
          <span class="pill ${c.status}">${c.status}</span>
        </div>
        <div class="msg">${esc(c.message)}</div>
        <textarea class="inp draftbox" ${c.status === "sent" ? "disabled" : ""}>${esc(
        c.ai_draft || ""
      )}</textarea>
        <div class="actions"></div>`;
      const ta = item.querySelector("textarea");
      const actions = item.querySelector(".actions");
      if (c.status !== "sent" && c.status !== "ignored") {
        const send = el("button", "btn btn-success btn-sm", "Reply publicly");
        send.addEventListener("click", async () => {
          try {
            await api(`/comments/${c.id}/send`, {
              method: "POST",
              body: JSON.stringify({ text: ta.value }),
            });
            toast("Comment reply posted ✓", "ok");
            render();
            refreshBadges();
          } catch (e) {
            toast(e.message, "err");
          }
        });
        const regen = el("button", "btn btn-sm", "🤖 Regenerate");
        regen.addEventListener("click", async () => {
          regen.textContent = "…";
          try {
            const r = await api(`/comments/${c.id}/regenerate`, { method: "POST" });
            ta.value = r.draft;
          } catch (e) {
            toast(e.message, "err");
          }
          regen.textContent = "🤖 Regenerate";
        });
        const ign = el("button", "btn btn-danger btn-sm", "Ignore");
        ign.addEventListener("click", async () => {
          await api(`/comments/${c.id}/ignore`, { method: "POST" });
          render();
          refreshBadges();
        });
        actions.append(send, regen, ign);
      }
      v.appendChild(item);
    });
  }

  // ---------------- Posts ----------------
  async function renderPosts(v) {
    v.innerHTML = `
      <div class="panel">
        <h3>✍️ Create a new post</h3>
        <label class="field">Let AI write it — describe the topic</label>
        <div class="row">
          <input class="inp grow" id="topic" placeholder="e.g. HSC 2026 physics question bank now available" />
          <button class="btn btn-primary" id="genBtn">🤖 Generate</button>
        </div>
        <label class="field">Post text</label>
        <textarea class="inp" id="postText" placeholder="Write or generate your post here…"></textarea>
        <div class="row">
          <div class="grow">
            <label class="field">Image URL (optional)</label>
            <input class="inp" id="postImage" placeholder="https://…/image.jpg" />
          </div>
          <div class="grow">
            <label class="field">Link (optional)</label>
            <input class="inp" id="postLink" placeholder="https://equestionbankbd.com/…" />
          </div>
        </div>
        <label class="field">Schedule (optional — leave empty to publish now / save draft)</label>
        <input class="inp" id="postWhen" type="datetime-local" />
        <div class="actions">
          <button class="btn btn-success" id="publishNow">🚀 Publish now</button>
          <button class="btn btn-primary" id="schedule">🕒 Schedule</button>
          <button class="btn" id="saveDraft">💾 Save draft</button>
        </div>
      </div>
      <div class="panel"><h3>Recent posts</h3><div id="postList"></div></div>`;

    $("#genBtn").addEventListener("click", async () => {
      const topic = $("#topic").value.trim();
      if (!topic) return toast("Enter a topic first", "err");
      $("#genBtn").textContent = "…";
      try {
        const r = await api("/posts/generate", {
          method: "POST",
          body: JSON.stringify({ topic }),
        });
        $("#postText").value = r.text;
        toast("AI wrote your post ✓", "ok");
      } catch (e) {
        toast(e.message, "err");
      }
      $("#genBtn").textContent = "🤖 Generate";
    });

    const savePost = async (scheduled) => {
      const message = $("#postText").value.trim();
      if (!message) return toast("Write some post text first", "err");
      const body = {
        message,
        image_url: $("#postImage").value.trim() || null,
        link: $("#postLink").value.trim() || null,
      };
      if (scheduled) {
        const when = $("#postWhen").value;
        if (!when) return toast("Pick a date & time to schedule", "err");
        body.scheduled_at = when.replace("T", " ") + ":00";
      }
      return api("/posts", { method: "POST", body: JSON.stringify(body) });
    };

    $("#saveDraft").addEventListener("click", async () => {
      try {
        await savePost(false);
        toast("Draft saved ✓", "ok");
        loadPostList();
      } catch (e) {
        toast(e.message, "err");
      }
    });
    $("#schedule").addEventListener("click", async () => {
      try {
        const p = await savePost(true);
        if (p) toast("Post scheduled ✓", "ok");
        loadPostList();
        refreshBadges();
      } catch (e) {
        toast(e.message, "err");
      }
    });
    $("#publishNow").addEventListener("click", async () => {
      try {
        const p = await savePost(false);
        await api(`/posts/${p.id}/publish`, { method: "POST" });
        toast("Published to Facebook ✓", "ok");
        loadPostList();
      } catch (e) {
        toast(e.message, "err");
      }
    });

    loadPostList();
  }

  async function loadPostList() {
    const box = $("#postList");
    if (!box) return;
    let posts = [];
    try {
      posts = await api("/posts");
    } catch {
      return;
    }
    if (!posts.length) {
      box.innerHTML = `<div class="empty">No posts yet.</div>`;
      return;
    }
    box.innerHTML = "";
    posts.forEach((p) => {
      const item = el("div", "item");
      const when = p.scheduled_at ? `🕒 ${esc(p.scheduled_at)}` : "";
      item.innerHTML = `
        <div class="head">
          <span class="pill ${p.status}">${p.status}</span>
          <span class="muted">${when}</span>
        </div>
        <div class="msg">${esc(p.message).slice(0, 400)}</div>
        ${p.error ? `<div class="error-text">${esc(p.error)}</div>` : ""}
        <div class="actions"></div>`;
      const actions = item.querySelector(".actions");
      if (p.status !== "published") {
        const pub = el("button", "btn btn-success btn-sm", "🚀 Publish now");
        pub.addEventListener("click", async () => {
          try {
            await api(`/posts/${p.id}/publish`, { method: "POST" });
            toast("Published ✓", "ok");
            loadPostList();
          } catch (e) {
            toast(e.message, "err");
          }
        });
        actions.appendChild(pub);
      }
      const del = el("button", "btn btn-danger btn-sm", "Delete");
      del.addEventListener("click", async () => {
        await api(`/posts/${p.id}`, { method: "DELETE" });
        loadPostList();
      });
      actions.appendChild(del);
      box.appendChild(item);
    });
  }

  // ---------------- Knowledge ----------------
  async function renderKnowledge(v) {
    let content = "";
    try {
      content = (await api("/knowledge")).content;
    } catch (e) {
      v.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    v.innerHTML = `
      <div class="panel">
        <h3>🧠 Knowledge Base</h3>
        <p class="muted">This is what your AI knows about eQuestionBankBD. Fill in every <b>&lt;&lt; FILL THIS &gt;&gt;</b>
        with your real info, then Save. Changes apply instantly.</p>
        <textarea class="inp" id="kb" style="min-height:60vh;font-family:ui-monospace,monospace;font-size:13px">${esc(
          content
        )}</textarea>
        <div class="actions"><button class="btn btn-primary" id="saveKb">💾 Save knowledge</button></div>
      </div>`;
    $("#saveKb").addEventListener("click", async () => {
      try {
        await api("/knowledge", {
          method: "PUT",
          body: JSON.stringify({ content: $("#kb").value }),
        });
        toast("Knowledge saved ✓", "ok");
      } catch (e) {
        toast(e.message, "err");
      }
    });
  }

  // ---------------- Settings ----------------
  async function renderSettings(v) {
    let s;
    try {
      s = await api("/settings");
    } catch (e) {
      v.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    const checked = (b) => (b ? "checked" : "");
    v.innerHTML = `
      <div class="panel">
        <h3>⚙️ Agent Behaviour</h3>
        <label class="field"><input type="checkbox" id="arm" ${checked(
          s.autoReplyMessages
        )}/> Auto-reply to Messenger messages (no approval needed)</label>
        <label class="field"><input type="checkbox" id="arc" ${checked(
          s.autoReplyComments
        )}/> Auto-reply to post comments (no approval needed)</label>
        <label class="field">Reply language</label>
        <select class="inp" id="lang">
          ${["banglish", "bangla", "english", "auto"]
            .map(
              (l) =>
                `<option value="${l}" ${l === s.replyLanguage ? "selected" : ""}>${l}</option>`
            )
            .join("")}
        </select>
        <div class="actions"><button class="btn btn-primary" id="saveSettings">💾 Save settings</button></div>
        <p class="muted" style="margin-top:14px">Tip: keep auto-reply OFF at first so you can review the AI's drafts in
        Inbox & Comments. Turn it ON once you trust the replies.</p>
      </div>`;
    $("#saveSettings").addEventListener("click", async () => {
      try {
        await api("/settings", {
          method: "PUT",
          body: JSON.stringify({
            autoReplyMessages: $("#arm").checked,
            autoReplyComments: $("#arc").checked,
            replyLanguage: $("#lang").value,
          }),
        });
        toast("Settings saved ✓", "ok");
        refreshStatus();
      } catch (e) {
        toast(e.message, "err");
      }
    });
  }

  // ---------------- Configuration (.env) ----------------
  const CONFIG_SECTIONS = [
    {
      title: "🖥️ Server & Login",
      fields: [
        { key: "PORT", label: "Port", type: "text", hint: "Changing this needs a restart." },
        { key: "DASHBOARD_USER", label: "Dashboard username", type: "text" },
        { key: "DASHBOARD_PASS", label: "Dashboard password", type: "password", secret: true },
      ],
    },
    {
      title: "🤖 AI Provider (free)",
      fields: [
        { key: "AI_PROVIDER", label: "Active provider", type: "select", options: ["gemini", "groq"] },
        { key: "GEMINI_API_KEY", label: "Gemini API key", type: "password", secret: true, hint: "Free key: aistudio.google.com/app/apikey" },
        { key: "GEMINI_MODEL", label: "Gemini model", type: "text" },
        { key: "GROQ_API_KEY", label: "Groq API key", type: "password", secret: true, hint: "Free key: console.groq.com/keys" },
        { key: "GROQ_MODEL", label: "Groq model", type: "text" },
      ],
    },
    {
      title: "📘 Facebook",
      fields: [
        { key: "FB_PAGE_ID", label: "Page ID", type: "text" },
        { key: "FB_PAGE_ACCESS_TOKEN", label: "Page access token", type: "password", secret: true },
        { key: "FB_VERIFY_TOKEN", label: "Webhook verify token", type: "text" },
        { key: "FB_GRAPH_VERSION", label: "Graph API version", type: "text" },
      ],
    },
    {
      title: "💬 Behaviour",
      fields: [
        { key: "AUTO_REPLY_MESSAGES", label: "Auto-reply to messages", type: "select", options: ["false", "true"] },
        { key: "AUTO_REPLY_COMMENTS", label: "Auto-reply to comments", type: "select", options: ["false", "true"] },
        { key: "REPLY_LANGUAGE", label: "Reply language", type: "select", options: ["banglish", "bangla", "english", "auto"] },
      ],
    },
  ];

  async function renderConfig(v) {
    let cfg;
    try {
      cfg = await api("/config");
    } catch (e) {
      v.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    const vals = cfg.values || {};

    const fieldHtml = (f) => {
      const val = vals[f.key] ?? "";
      const hint = f.hint ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc(f.hint)}</div>` : "";
      let input;
      if (f.type === "select") {
        input = `<select class="inp" data-key="${f.key}">${f.options
          .map((o) => `<option value="${o}" ${o === val ? "selected" : ""}>${o}</option>`)
          .join("")}</select>`;
      } else if (f.secret) {
        input = `<input class="inp" data-key="${f.key}" data-secret="1" type="password" value="${esc(
          val
        )}" placeholder="(not set)" />`;
      } else {
        input = `<input class="inp" data-key="${f.key}" type="${f.type}" value="${esc(val)}" />`;
      }
      return `<label class="field">${esc(f.label)}</label>${input}${hint}`;
    };

    v.innerHTML =
      CONFIG_SECTIONS.map(
        (s) =>
          `<div class="panel"><h3>${s.title}</h3>${s.fields.map(fieldHtml).join("")}</div>`
      ).join("") +
      `<div class="panel">
         <p class="muted">Secret fields show only the last 4 characters. Leave them as-is to keep the current value,
         or type a new value to replace it. Changes apply instantly (except Port).</p>
         <div class="actions"><button class="btn btn-primary" id="saveConfig">💾 Save configuration</button></div>
       </div>`;

    $("#saveConfig").addEventListener("click", async () => {
      const values = {};
      v.querySelectorAll("[data-key]").forEach((node) => {
        const key = node.getAttribute("data-key");
        const isSecret = node.getAttribute("data-secret") === "1";
        const val = node.value;
        // skip unchanged masked secrets so we don't overwrite real values
        if (isSecret && (val === "" || val.startsWith("••••"))) return;
        values[key] = val;
      });
      try {
        const r = await api("/config", { method: "PUT", body: JSON.stringify({ values }) });
        toast(r.restartRequired ? "Saved ✓ (restart for new port)" : "Configuration saved ✓", "ok");
        refreshStatus();
        renderConfig(v);
      } catch (e) {
        toast(e.message, "err");
      }
    });
  }

  // ---------------- Boot ----------------
  if (auth) {
    api("/status").then(showApp).catch(logout);
  }
})();
