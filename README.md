# eQuestionBankBD — AI Facebook Page Agent

A professional, company-grade AI agent that manages your **eQuestionBankBD** Facebook Page.
It can:

- 💬 **Reply to Messenger messages** based on what the customer needs (in Banglish)
- 📝 **Reply to comments** on your posts
- 🚀 **Write, schedule, and publish posts** (text, image, links) — AI writes the content
- 🔗 **Share the right links** automatically from your knowledge base
- 🧠 **Know everything about eQuestionBankBD** via an editable knowledge file
- 🖥️ Comes with a **full web dashboard** (inbox, comments, post composer, analytics, settings)

It uses a **free AI provider** (Google Gemini free tier by default; Groq also supported).

---

## Quick start (5 steps)

```bash
# 1. Go to the project
cd ~/Projects/equestionbankbd-ai-agent

# 2. Install dependencies
npm install

# 3. Create your config from the template
cp .env.example .env

# 4. Open .env and fill in your AI key (and Facebook details when ready)
#    - Get a FREE Gemini key: https://aistudio.google.com/app/apikey
#    - Set DASHBOARD_USER / DASHBOARD_PASS to your own login

# 5. Start it
npm run dev
```

Then open **http://localhost:3000** and log in with the dashboard user/password
you set in `.env`.

> You can use the dashboard and the AI **before** connecting Facebook —
> it will create drafts you can review. To go fully live (auto-reading and
> auto-replying), connect Facebook by following **SETUP_FACEBOOK.md**.

---

## How it works

```
Facebook Page  ──webhook──▶  Server (Express)  ──▶  AI (Gemini/Groq)  ──▶  Draft reply
                                   │                                          │
                                   ▼                                          ▼
                              SQLite DB  ◀────────  Dashboard (approve/edit/send)
                                   │
                                   └──▶ Facebook Graph API (send reply / publish post)
```

- New messages & comments arrive at `/webhook` in real time.
- The AI writes a draft reply using your **knowledge base**.
- By default replies wait for your approval in the dashboard (safe mode).
- Flip **Auto-reply** ON in Settings once you trust it.
- Scheduled posts publish automatically (checked every minute).

---

## Configuration (`.env`)

| Key | What it is |
|-----|------------|
| `AI_PROVIDER` | `gemini` (free) or `groq` (free) |
| `GEMINI_API_KEY` | Free key from https://aistudio.google.com/app/apikey |
| `GROQ_API_KEY` | Free key from https://console.groq.com/keys |
| `DASHBOARD_USER` / `DASHBOARD_PASS` | Your dashboard login |
| `FB_PAGE_ID` | Your Facebook Page ID |
| `FB_PAGE_ACCESS_TOKEN` | Page access token (see SETUP_FACEBOOK.md) |
| `FB_VERIFY_TOKEN` | Any secret string you choose |
| `AUTO_REPLY_MESSAGES` / `AUTO_REPLY_COMMENTS` | `true`/`false` |
| `REPLY_LANGUAGE` | `banglish` / `bangla` / `english` / `auto` |

---

## The knowledge base = the AI's brain

Edit **`knowledge/equestionbankbd.md`** (or use the **Knowledge** tab in the
dashboard). Fill in your services, prices, links, FAQ, and contact info.
The AI only answers from this file — so the more you put, the smarter it gets,
and it will never make up false information.

---

## Project structure

```
equestionbankbd-ai-agent/
├─ src/
│  ├─ index.ts            # server entry
│  ├─ config.ts           # env config
│  ├─ db.ts               # SQLite setup
│  ├─ scheduler.ts        # scheduled-post publisher
│  ├─ routes/
│  │  ├─ webhook.ts       # Facebook webhook (messages + comments)
│  │  └─ api.ts           # dashboard API
│  └─ services/
│     ├─ ai.ts            # Gemini / Groq (free)
│     ├─ agent.ts         # persona + prompts
│     ├─ facebook.ts      # Graph API client
│     ├─ inbox.ts         # message/comment processing
│     └─ knowledge.ts     # loads the knowledge file
├─ public/                # dashboard (HTML/CSS/JS)
├─ knowledge/             # editable knowledge base
└─ data/                  # SQLite database (auto-created)
```

---

## Going live & deployment

For Facebook to send events, your server must be reachable on the internet
over HTTPS. Easiest options:

- **Testing:** run `npx localtunnel --port 3000` or `ngrok http 3000` and use
  the HTTPS URL as your webhook callback.
- **Production:** deploy to Railway, Render, a VPS, etc., and point the webhook
  to `https://your-domain/webhook`.

Full Facebook connection steps are in **SETUP_FACEBOOK.md**.

---

## Safety notes

- Start with **auto-reply OFF** and review drafts until you trust the AI.
- Keep `.env` private (it holds your keys) — it is git-ignored.
- The AI is instructed never to invent prices/links or handle refunds itself;
  it escalates those to you.
```
