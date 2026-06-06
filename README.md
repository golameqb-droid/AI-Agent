# SocialAI Pro

**Multi-vendor SaaS platform** for AI-powered Facebook Page management.
Sell this service to vendors — each gets their own isolated dashboard, Facebook credentials, knowledge base, and AI agent.

## Phase 1 — Multi-vendor foundation ✅

- Vendor registration & JWT login
- Per-vendor Facebook config, knowledge base, AI settings
- Isolated inbox, comments, posts per vendor
- Webhook routes messages to the correct vendor by Page ID
- Super admin panel (manage all vendors)
- AI providers: Gemini, Groq, **Anthropic Claude**

## Phase 2 — Products & handoff ✅

- Per-vendor product catalog with image uploads
- AI sends product photos in Messenger
- Human handoff queue with vendor takeover

## Phase 3 — Orders & Excel export ✅

- AI captures orders from Messenger (product, qty, phone, address)
- Vendor **Orders** tab — confirm, ship, deliver, cancel
- Manual order entry + **Export Excel** (CSV download)

## Phase 4 — Advanced posts ✅

- Post templates, scheduling, bulk schedule API
- Title/tags on posts

## Phase 5 — Omnichannel ✅

- **Messenger** + **WhatsApp** + **Instagram** unified inbox
- Per-vendor channel config (admin-managed)
- Webhooks: `/webhook`, `/webhook/whatsapp`, `/webhook/instagram`

## Phase 6 — Commercial subscriptions ✅

| Plan | Price | Messages | Channels |
|------|-------|----------|----------|
| Trial | Free 14 days | 500 | Messenger |
| Pro | ৳12,500/mo | 18,000 | All 3 |
| Elite | ৳26,000/mo | 40,000 | All 3 |
| Enterprise | Custom | Unlimited | All 3 |

- Usage limits enforced per plan
- Payments: **bKash**, **Nagad**, **SSLCommerz**
- Public pricing page: `/pricing`
- Vendor self-registration with free trial

---

## Quick start

```bash
npm install
cp .env.example .env   # edit JWT_SECRET and super admin credentials
npm run dev
```

Open **http://localhost:3000**

### Accounts

| Role | How to access |
|------|---------------|
| **Vendor** | Register tab → create business account |
| **Super Admin** | Admin tab → `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` from `.env` |

Default super admin (change in `.env`):
- Email: `golarambbi620@gmail.com`
- Password: set via `SUPER_ADMIN_PASSWORD` in `.env`

Production app URL: `https://socialaipro-app.equestionbankbd.com`

### Each vendor sets up

1. **Configuration** → Facebook Page ID + token, AI provider + API key
2. **Knowledge** → business info, products, FAQ
3. **Settings** → auto-reply on/off
4. Meta webhook Callback URL → `https://YOUR-DOMAIN/webhook`
5. Verify token → `FB_VERIFY_TOKEN` from `.env` (shared platform token)

---

## Docker

```bash
docker compose up -d --build
```

---

## Architecture

```
Vendor A ──┐
Vendor B ──┼──▶ SocialAI Pro Platform ──▶ Facebook Webhook
Vendor C ──┘         │                        │
                     ├── Per-vendor DB rows   └── Routes by Page ID
                     ├── Per-vendor AI config
                     └── Super admin oversight
```

---

## Repo

https://github.com/golameqb-droid/AI-Agent.git
