# Transactional email: plan (not implemented yet)

Status: **planning only.** No email leaves the app today. This document records what we
found, what we decided, what is still open, and what to do when this is picked up again.
Written 2026-10-10. Production discovery was collected the same day (section 9): the plan
below already reflects it.

## 1. Goal

Send transactional email from the app with an address on our own domain
(`no-reply@nlights.app`): password reset first, plus the notifications the app already
tries to send (card payment due, report ready).

## 2. Infrastructure context

- Domain `nlights.app` (and `www.nlights.app`, a CNAME to the apex), registered at **Porkbun**,
  which also hosts its DNS.
- Hosted on a **Hetzner Cloud** VPS behind an nginx reverse proxy with Let's Encrypt
  certificates.
- `.app` is on the HSTS preload list: HTTPS is mandatory.
- Server internals (addresses, hostnames, paths, ports, firewall rules) are deliberately
  **not** written here: this repository is public. They live in the operator's private
  infrastructure notes.

## 3. What the code has today

| Piece | State |
|---|---|
| `app/tasks/email.py` -> `send_email(to, subject, body_html)` | **Stub**: only writes a structured log (`email_send_stub`). |
| `notification_service.send_email_notification` | Real, honors the user's `email_notifications` preference, calls the Celery task. Used by the card-due alert (`tasks/alerts.py`) and the report-ready notices (`report_service.py`, two places). |
| `auth_service.forgot_password` | Creates the token (`pwd_reset:<token>` in Redis, 15 min) and **never sends it**. |
| `auth_service.reset_password` | Works end to end (token check, new password, `logout_all`). |
| Frontend | **No** "forgot password" / "reset password" screens. `Login` has no link to them. |
| Config | `EMAIL_FROM` still `noreply@finanzas.app` (old domain); `FRONTEND_URL` exists. No mail library; `httpx` is already a dependency. |
| `POST /auth/forgot-password` | **No rate limit.** Harmless while nothing is sent; an email-bombing vector once it is real. |
| Email verification at sign-up | Does not exist. Out of scope here. |

## 4. Decisions so far

1. **Use an HTTPS email API, not SMTP.** Confirmed on the production server: outbound ports
   25 and 465 time out, while 443 (and 587/2587/2525) are open. An API over 443 needs no
   new library. If SMTP is ever wanted as a fallback, only 587 / 2587 (STARTTLS) work;
   never 465 or 25.
2. **Provider: Resend (recommended), still to be confirmed.** Alternatives: Postmark, Brevo.
   Check the current free-tier limits on the provider's site before deciding.
3. **Provider-agnostic code**, like the AI provider: `EMAIL_PROVIDER=log|resend|smtp`.
   `log` is the default for development and tests (today's behavior); production uses the
   real one. In production, a missing provider must be reported loudly, not silently
   downgraded to `log`.
4. **Notification emails should not carry amounts.** Recommended text: "Your card X is due
   in N days, open the app", without the balance. Email is a weaker channel than the app.
5. Password-reset email is **transactional**: it ignores the `email_notifications`
   preference. Notification emails keep honoring it.

### Provider options (limits checked on 2026-10-10; prices change, re-check before paying)

| Option | Free tier | Notes for us |
|---|---|---|
| **Resend** (HTTPS API) | 3,000 emails/month, max 100/day (UTC day), up to 3 domains; sent and received count together | Simplest API and DNS. Pro is $20/month for 50,000 with no daily cap. Offers inbound email too (could solve receiving at `nlights.app`; verify before relying on it). |
| **Brevo** (API + SMTP 587) | 300 emails/day, API included | Higher daily cap, SMTP relay on 587 (open from the production server). Overflow goes to a retry queue of up to 1,000. Paid from $9/month for 5,000. |
| **Postmark** (API + SMTP) | 100 emails/month, no overage | Strong deliverability reputation, but the free tier is too tight and the first paid tier is $15/month for 10,000. |
| **Amazon SES** (API + SMTP) | none (pay per use): $0.10 per 1,000 | Cheapest at scale. New accounts start in a sandbox (200 messages/day, verified recipients only) and need a production-access request. More setup than the others. |

Current volume is 2 users, so every free tier is enough; the choice is about simplicity and
about how painful switching later would be. Because the code is provider-agnostic
(`EMAIL_PROVIDER=log|resend|smtp`), switching later is a configuration change: the generic
SMTP path (port 587) works with Brevo, Postmark and SES.

Sources: [Resend pricing](https://resend.com/pricing), [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits),
[Postmark pricing](https://postmarkapp.com/pricing), [Brevo free plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan),
[Amazon SES pricing](https://aws.amazon.com/ses/pricing/), [SES sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

## 5. Work to do (code)

1. `app/services/email_service.py`: provider abstraction (`log`, `resend` over `httpx`,
   optional `smtp`).
2. Make the Celery task `email.send` use it: retry with exponential backoff on network
   errors and 5xx, never on 4xx. Never log the body of a reset email or the token.
3. Templates: HTML + plain text, Spanish and English chosen from the user's
   `user_preferences.locale`. Types: password reset; generic notification (card due, report
   ready) with a footer linking to Settings to manage notifications.
4. Wire `forgot_password` to send `${FRONTEND_URL}/reset-password?token=...`.
5. Frontend: `ForgotPassword` and `ResetPassword` pages, a link from `Login`, es/en copy.
6. Abuse protection on `/auth/forgot-password`: per-email and per-IP limits with Redis (same
   pattern as login attempts). Always answer the same whether or not the email exists.
7. Settings in `core/config.py` and `.env.example`: `EMAIL_PROVIDER`, `EMAIL_API_KEY`,
   `EMAIL_FROM` (e.g. `NorthernLights <no-reply@nlights.app>`), `EMAIL_REPLY_TO` (optional).
8. Tests with a mocked HTTP transport: provider call shape, retry rules, reset flow sends
   the link, no leak of whether an email exists, templates render in both languages, `log`
   provider in the test suite.

## 6. DNS records (Porkbun)

Exact values come from the provider's dashboard after adding the domain; the shape is:

| Record | Purpose |
|---|---|
| TXT (SPF) on a sending subdomain, e.g. `send.nlights.app` | Authorizes the provider to send for the domain. |
| TXT or CNAME (DKIM), e.g. `resend._domainkey` | Signs each message. |
| MX on that same subdomain | Bounce / complaint handling. |
| TXT `_dmarc.nlights.app`: `v=DMARC1; p=none; rua=mailto:<mailbox>` | Policy and reports. Start at `p=none`, move to `quarantine` once stable. |

Notes:
- There can be **only one SPF record per domain**. If Porkbun email hosting is ever added,
  merge the two.
- Mail cannot be received at `no-reply@`. For replies use `Reply-To` or an email forward
  configured at Porkbun.
- Nobody on the project has Porkbun API credentials in the repo. The records are added by
  hand in the Porkbun panel.

## 7. Privacy

The email provider becomes a processor that receives each user's address and the message
text. Before this goes live:
- Update `docs/DISCLAIMER_INPUTS.md` and the privacy notice (`frontend-web/src/lib/disclaimer.ts`
  and its readable copy `docs/legal/DISCLAIMER.md`; they must match).
- Bumping `DISCLAIMER_VERSION` makes every user accept the notice again. Decide whether the
  change is material enough to require it.

## 8. Deploy notes

- The new variables go in the production `.env`. The **Celery worker** is the process that
  sends, and it shares that `.env` (`env_file`); recreate it after changing the file.
- The API key goes straight into the server's `.env`, never into a chat, a commit or a log.
- Order: add the domain at the provider -> add DNS records -> wait until the provider shows
  "verified" -> deploy -> send a test.
- Verify deliverability: send to a Gmail address, open "Show original" and check that SPF,
  DKIM and DMARC all say `PASS`.

## 9. Production discovery (collected 2026-10-10, read-only)

Findings from a read-only inspection of the production server. Only conclusions are kept
here; host-specific details stay in private notes.

**Outbound connectivity (TCP connect test from the server).**

| Port | Result |
|---|---|
| 25 | timeout (blocked) |
| 465 | timeout (blocked) |
| 587 | open |
| 2465 / 2587 / 2525 | open |
| 443 (provider HTTPS APIs) | open |

All failures were timeouts (silent filtering). Whether the block is on Hetzner's network
or local could not be told apart (reading the firewall needs root).

**DNS of `nlights.app`.** Only the address record and the `www` CNAME exist. There are **no**
MX, SPF, DKIM, DMARC or CAA records. Authoritative servers (Porkbun) agree with public
resolvers.

**Mail software on the server.** None installed, nothing listening on port 25.

**Application configuration.** `EMAIL_FROM` in production still points to the old
pre-launch domain, and there are no provider variables. `DISCLAIMER_VERSION` is not set in
the production `.env`, so the code default in `core/config.py` applies (the frontend's
`disclaimer.ts` must match it). The Celery worker is healthy; there is no log history of
the email stub (containers were recreated), so that check is inconclusive.

**Scale.** The user base is tiny: any provider's free tier is enough.

### What this changes in the plan

1. **Transport settled:** HTTPS API over 443. SMTP only as a fallback on 587/2587.
2. **DNS starts from zero, with no conflicts.** No existing SPF means no merging; every
   record the provider asks for can be added as-is. Receiving mail needs an MX that does
   not exist: if replies or a visible support address are wanted, set up a forward at
   Porkbun (an MX on the apex does not clash with a sending subdomain).
3. **Production `.env` changes**, besides the new provider variables: `EMAIL_FROM` must move
   to `no-reply@nlights.app` (the current value would never match the verified domain),
   and the worker must be recreated after editing it.
4. **The privacy-notice change in section 7 would affect very few accounts.**
5. **Not verified:** firewall rules (need root), whether the 25/465 block is Hetzner's or
   local, and the reputation of the server's IP. None of them blocks the plan, since mail
   goes through an external provider.

## 10. Open questions

1. Provider: Resend or another?
2. Sender address and optional `Reply-To` / receiving mailbox.
3. Notification emails without amounts (recommended) or with them?
4. Bump `DISCLAIMER_VERSION` for the new processor? (Production has it unset: it follows
   the code default, so bumping means changing the default in `core/config.py` together
   with `disclaimer.ts`.)
5. Branch for the work: suggested `feature/transactional-email`.
