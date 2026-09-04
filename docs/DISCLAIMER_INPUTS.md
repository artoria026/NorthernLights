# Inputs for the privacy notice / disclaimer — NorthernLights

This document **is not the disclaimer** — it's the inventory of features and data handling
that another agent (or lawyer) will use as input to draft one. Everything written here is
verified against the actual code in the repo (`/home/artoria026/projects/personal/northern_lights`),
with file:line references so it can be confirmed. Cutoff date: 2026-08-14.

**Golden rule for whoever drafts the disclaimer from this**: don't promise anything that
isn't confirmed here. In particular, see section 4 — there's an important legal distinction
between "encrypted" and "isolated via RLS" that must not be conflated.

---

## 1. What the app is

A single-user-per-account personal finance web app (there's no shared/family account concept
as a product feature, although an individual debt or transaction can be marked as "shared"
with a third party by free-text name). Double-entry accounting, budget, debt tracking,
recurring expenses/subscriptions, historical reports, and an AI financial advisor that can
read and create transactions via chat, including attaching PDFs of bank statements.

---

## 2. Inventory of screens/features

| Screen | What it does | User data involved |
|---|---|---|
| Login / Register | Sign-up and login with email+password; Google login exists on the backend but **is disabled today** on the frontend button (`frontend-web/src/pages/Login.tsx` — `GOOGLE_LOGIN_ENABLED = false`, no `GOOGLE_CLIENT_ID`/`SECRET` configured). | Name, email, password. |
| Home (Dashboard) | Overall summary: accounts, budget, debts, recurring items, insights, monthly reports, recent transactions. | Essentially the user's entire financial snapshot, at a glance. |
| Accounts | Create/edit/delete accounts (bank, cash, credit card, savings), reconciliation, custom logo. | Account name, **last 4 digits of card**, balance, credit limit, interest rate, billing/due day, logo (image). |
| Transactions | Create/edit/delete transactions, shared expenses, calendar. | Amount, date, description, category, notes, tags, and the **other person's name** on a shared expense. |
| Categories | Custom and system categories, hiding categories. | Names/colors of custom categories. |
| Debts | Debts owed by the user or by third parties who owe the user, payment plans, "debt with no plan". | Debt name, **creditor's name**, amount, rate, installments, and who else is involved if shared. |
| Recurring / Subscriptions | Periodic expenses/income, confirming or rejecting automatically generated charges. | Amount, frequency, associated account, service URL. |
| Budget | Monthly limits per category, trend, suggestions. | Budgeted vs. spent amounts. |
| Goals | Placeholder screen ("Coming soon") — no real data yet. | None. |
| Insights | AI-generated recommendations/alerts about financial habits. | AI-generated text + the user's financial metrics at that moment. |
| Reports | Monthly/annual reports with a summary and AI insights for the period. | Financial summaries per period + saved AI insights. |
| Notifications | In-app inbox (debt, budget, card, payment, subscription alerts). | Notification title/body. |
| **AI Advisor** | AI chat that sees the user's actual financial state, can create accounts/debts/expenses if confirmed, and can read attached bank statement PDFs. | **The most sensitive of all** — see section 3, information is sent to an external provider. |
| Settings | Profile, password change, preferences, unlink Google, **selective data deletion**, **permanently delete account**, log out (one session or all). | Real user control over their own data — relevant to any ARCO-type right/portability the disclaimer promises. |
| Admin (admin role only) | Platform administration panel. | Sees data for **all users** — see section 5. |

---

## 3. What personal/financial data is collected and stored

- **Identity**: name, email, password (hashed), avatar, role, auth provider (email/Google).
- **Devices**: device name and type, push token (once enabled), refresh token (hashed, never
  in plain text).
- **Financial**: accounts (with last 4 digits of card), all transactions with double-entry
  accounting, debts (including **names of creditors/third parties**), budgets, recurring
  expenses/subscriptions, reports and AI-generated insights about the user's financial
  behavior.
- **AI Advisor chat**: the **full text of every message is stored permanently** in the
  database (with no automatic expiration) until the user manually deletes it from Settings or
  the "clear history" button in the chat. Attached bank statement PDFs **are never stored**
  (neither the file nor its password) — they're processed in memory and discarded after the
  response; what can remain is the text extracted from them, if it ends up as part of a
  created transaction/debt or in the saved chat message itself.
- **Feedback**: bug/suggestion messages the user sends from the app, visible to any platform
  administrator (not just the user themself).

---

## 4. Third parties that user information is sent to

This is the most important section for the privacy notice — probably where explicit consent
is needed.

### AI providers (Google Gemini / Anthropic Claude)
- **With every message** the user sends to the AI Advisor, it's sent along with **the user's
  complete financial snapshot** (accounts, debts, budget, recent transactions, financial
  health) as context — not only when finances are explicitly asked about.
- The **recent chat history** (last ~10 exchanges) is also resent on every call.
- If the user attaches a **bank statement PDF**, that file (with its password already
  stripped) is sent directly to the AI provider so it can read it.
- The active provider is configurable (`AI_PROVIDER`: Gemini or Claude) — the project
  currently has credentials configured for both.
- **In practice, this means sharing complete banking/financial data with an external AI
  provider (Google or Anthropic) on every use of the Advisor.** The disclaimer needs to cover
  this explicitly and probably request specific consent, separate from the app's general
  consent.

### Google OAuth (login) — implemented but inactive today
- The flow exists on the backend and, if enabled, sends OAuth credentials to Google and gets
  back email, name, profile photo, and a unique Google ID.
- **Not active in production yet** (button disabled on the frontend due to missing configured
  credentials) — but the disclaimer should account for it now if there are plans to enable it
  soon, to avoid having to re-notify users later.

### Firebase Cloud Messaging (push notifications) — implemented but inactive today
- The code to send push notifications via Firebase (Google) exists but is currently a no-op
  (no Firebase credentials configured). Once enabled, it would send the device token plus the
  notification content to Firebase.

### What does NOT exist (so as not to over-promise or under-disclose)
- There's no Sentry, analytics, or any other third-party tracker integrated today.
- There's no real email sending — password recovery by email is *stubbed* (it only logs, no
  real email ever reaches the user), and that screen isn't even exposed on the frontend.

---

## 5. Admin panel — what an admin can see about other users

- **Can see**: email, name, role, auth provider, whether the account is active, sign-up date,
  and **counts** of accounts/transactions (numbers, not amounts or content) for any user on
  the platform. Platform-wide aggregate stats (total users, active, new, total
  accounts/transactions/debts — all anonymous/aggregated). Any user's feedback message
  (bug/suggestion), with its status.
- **Can do**: activate/deactivate any user account, change any user's role to admin/user
  (except their own account in both cases).
- **Cannot see** (no evidence in the code that this exists): balances, individual
  transactions, debts, or the content of other users' chats. Cross-user access is limited to
  account metadata + platform aggregates + feedback.

---

## 6. Actual security that exists today (be precise, don't over-promise)

- **Data is NOT encrypted at rest.** Separation between users is done via PostgreSQL **Row
  Level Security (RLS)** — logical isolation at the database engine level, reinforced by a
  separate read-only role (`BYPASSRLS`) that the Admin panel uses for its aggregations. This
  is real and a good architectural practice, but **it is not the same as "encryption"** — if
  the disclaimer is going to use the word "encrypted", it has to be about something that's
  actually encrypted (see the next two points), not about the isolation between accounts.
- **User passwords ARE hashed** with bcrypt (salted, not reversible) — this can legitimately
  be called real cryptographic protection.
- **Session refresh tokens are hashed** (SHA-256) before being stored, never in plain text;
  with single-use rotation on every renewal.
- **There is HTTPS/TLS in production** (Let's Encrypt via Certbot on the app's domain) —
  traffic between the user's browser and the server does travel encrypted in transit. (The
  internal hop between the proxy and the backend, within the same server, is plain HTTP —
  standard pattern, not exposed to the internet.)
- **Bank statement PDF passwords are never stored** anywhere (not on disk, not in the
  database, not in logs) — they're used once in memory to open the file and then discarded.

---

## 7. Current legal status — this doesn't exist yet

- **There is no "I accept the terms" checkbox or link to a privacy policy** on registration or
  login, today.
- **No terms and conditions file or privacy notice exists** in the repo yet.
- The only thing resembling it are marketing phrases on the login/registration screens ("Tus
  datos, tus reglas", "Privado desde el día uno" — kept in Spanish as they're the actual
  user-facing app copy) that describe RLS-based isolation — make sure the disclaimer doesn't
  contradict or over-promise relative to those already-visible phrases.

---

## 8. Key points the disclaimer should cover (checklist for whoever drafts it)

1. What personal data is collected (identity + financial + chat) — see sections 2-3.
2. That complete financial information is shared (including bank statement PDFs) with
   external AI providers (Google Gemini / Anthropic Claude) on every use of the Advisor —
   this probably warrants specific consent, not just generic consent.
3. That the advisor chat is stored permanently until the user deletes it.
4. That there's an administrator role with limited visibility (metadata + aggregates +
   feedback, not amounts/transactions/chat) into other users.
5. An honest description of security: RLS-based isolation + TLS in transit + password/token
   hashing — **avoid the word "encrypted" for data at rest**, it doesn't apply today.
6. User rights over their data: selective deletion and account deletion already exist in
   Settings — the disclaimer can lean on that to talk about ARCO/portability rights.
7. Use of cookies/session tokens (JWT + refresh token) to keep the session logged in.
8. That Google OAuth and push notifications are implemented but not active yet — word it to
   cover both cases without having to re-notify when they're enabled.
9. Minimum age / not directed at minors (a business decision still to be made, nothing in the
   code today determines this).
10. Contact for exercising rights / privacy questions (channel to be defined).

---

## 9. Where to show it in the app (recommendation, not implemented yet)

- **Registration**: mandatory checkbox "I accept the Terms and Privacy Notice" with a link to
  the document, before the account can be created — today `Register.tsx` has none of this.
- **Login/Registration**: visible link to the terms/privacy in the footer of both screens, no
  account needed to read it.
- **Settings**: permanent link to re-read the notice at any time.
- **Existing users**: if the notice is added after accounts already exist, a "one-time" notice
  similar to the one that already exists for the changelog (`user.last_seen_changelog_version`
  + auto-opening modal — see `frontend-web/src/components/ChangelogButton.tsx` as a reference
  for the pattern) makes sense, but for a new terms version, blocking use until accepted.
- **AI Advisor specifically**: since it's the only point where financial data is shared with a
  third party (Google/Anthropic), a short, specific notice there is worth it (e.g. the first
  time that screen is opened, or the first time a PDF is attached) in addition to the general
  notice — it's not enough for it to be buried inside the general privacy notice.
