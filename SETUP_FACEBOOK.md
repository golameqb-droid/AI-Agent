# Connecting Your Facebook Page (Step-by-Step)

You said you have the **Page** but no developer app yet. This guide takes you from
zero to a fully connected AI agent. Take it slowly — it's mostly clicking buttons.

> ⏱️ Time: ~30–45 minutes. You need: admin access to your Facebook Page.

---

## Overview

To let software read messages/comments and post for you, Facebook requires:

1. A **Facebook Developer App**
2. The **Messenger** + **Webhooks** products added to it
3. A **Page Access Token** (a long secret key)
4. **App Review** for some permissions (for going fully public beyond yourself)

You can fully test everything **as the page admin** before App Review.

---

## Step 1 — Become a Facebook Developer

1. Go to https://developers.facebook.com/
2. Click **Get Started** (top right) and follow the prompts (verify phone/email).

## Step 2 — Create an App

1. Go to https://developers.facebook.com/apps/ → **Create App**
2. Use case: choose **"Other"** → app type **"Business"** → Next.
3. Give it a name (e.g. `eQuestionBankBD Agent`) and create it.
4. Copy the **App ID** somewhere safe.

## Step 3 — Add products

In your app's left sidebar → **Add product**, then add:

- **Messenger** (for inbox/messages)
- **Webhooks** (for real-time events)

## Step 4 — Connect your Page & get a Page Access Token

1. App → **Messenger → Settings**.
2. Under **Access Tokens**, click **Add or remove Pages** → select your
   eQuestionBankBD Page and grant the permissions it asks for.
3. After connecting, click **Generate token** next to your Page.
4. **Copy this Page Access Token.** Paste it into `.env`:
   ```
   FB_PAGE_ACCESS_TOKEN=EAAG...your token...
   ```
   > Tip: this token can expire. For a permanent one, generate a
   > **long-lived / never-expiring Page token** via the Graph API Explorer later.

## Step 5 — Find your Page ID

1. Open your Facebook Page → **About** (or Page settings) → look for **Page ID**.
2. Put it in `.env`:
   ```
   FB_PAGE_ID=1234567890
   ```

## Step 6 — Pick a verify token

Make up any random secret string and put the **same** value in `.env`:
```
FB_VERIFY_TOKEN=equestionbankbd_verify_secret_123
```

## Step 7 — Put your server online (HTTPS)

Facebook can only send events to a public HTTPS URL.

**For testing (quickest):**
```bash
# In one terminal:
npm run dev
# In another terminal (gives you an https URL):
npx localtunnel --port 3000
#   → e.g. https://chatty-cat-12.loca.lt
```
Use that HTTPS URL as your base. (ngrok works too: `ngrok http 3000`.)

**For production:** deploy to Railway / Render / a VPS and use your real domain.

## Step 8 — Set up the Webhook

1. App → **Messenger → Settings → Webhooks** (or the **Webhooks** product).
2. **Callback URL:** `https://YOUR-PUBLIC-URL/webhook`
3. **Verify Token:** the same string as `FB_VERIFY_TOKEN` above.
4. Click **Verify and Save** → you should see "verified" (your server logs
   `Webhook verified by Facebook.`).
5. **Subscribe** to these fields:
   - From **Page** subscriptions: `feed` (for comments)
   - From **Messenger**: `messages`, `messaging_postbacks`
6. Under **Messenger → Settings → Webhooks**, make sure your **Page** is
   **subscribed** to the app.

## Step 9 — Permissions you'll need

For the agent to work, your app uses these permissions:

- `pages_messaging` — send/receive Messenger messages
- `pages_manage_posts` — create posts
- `pages_read_engagement` / `pages_manage_engagement` — read & reply to comments
- `pages_show_list` — list your pages

While in **Development mode**, these work for **you** (the admin/testers).
To serve the **public**, submit these for **App Review** (Step 11).

## Step 10 — Test it 🎉

1. Make sure `npm run dev` is running and `.env` is filled in.
2. From **another** Facebook account, message your Page and comment on a post.
3. Watch the **Inbox** and **Comments** tabs in your dashboard — AI drafts appear.
4. Approve a reply → it posts back to Facebook.
5. Try **Create Post → Generate → Publish now** to post from the dashboard.

## Step 11 — Go fully public (App Review)

1. App → **App Review → Permissions and Features**.
2. Request the permissions in Step 9 (Facebook will ask for a short
   description + screen recording of how you use each one).
3. Complete **Business Verification** if prompted.
4. Once approved, switch the app from **Development** to **Live** (top toggle).

---

## Troubleshooting

| Problem | Fix |
|--------|-----|
| Webhook won't verify | `FB_VERIFY_TOKEN` in `.env` must exactly match the dashboard; server must be running and public. |
| No messages arriving | Re-check Page is **subscribed** to the app and `messages`/`feed` fields are ticked. |
| "Invalid OAuth token" | Token expired — generate a new Page token (Step 4). |
| Replies fail to send | Token needs `pages_messaging`; the user must have messaged you within 24h (FB policy). |
| Can't reply to comments | Token needs `pages_manage_engagement`. |

Need help with any step? Ask and I'll walk you through it.
