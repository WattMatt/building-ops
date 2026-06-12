# Onboarding Runbook — Building Ops (web)

> When a client "can't log in", find their symptom here. Every failure mode below
> was hit in production on 2026-06-11; each now has a recovery action **in the
> product**. After every web deploy, run `node scripts/auth-smoke.mjs` (see §4).

## 1. The user lifecycle

| State | Badge in User Management | Meaning |
|---|---|---|
| Invited — never signed in | yellow | Account exists, user has never authenticated. Waiting on the invite email or link. |
| Password setup pending | yellow | User HAS signed in but the first-login gate (`must_set_password`) is still set — they haven't completed a password of their own. |
| Active | green | Confirmed, password set, gate cleared. |
| Deactivated | grey | Banned via set-user-status; reactivate from the same menu. |

## 2. Recovery actions (User Management → row menu)

- **Resend invite email** — generates a *fresh* 24-hour sign-in link and emails it via Resend (branded). Works regardless of how the original invite died; also auto-confirms the address (the admin is vouching for it).
- **Copy sign-in link** — same fresh link, copied to your clipboard instead of emailed. **This is the email-independence valve**: WhatsApp it, paste it in Teams, read it over the phone. Use it whenever email is in doubt.
- Both land the user on `/set-password`, which clears the first-login gate on completion. (`/reset` also clears it since 2026-06-11.)

## 3. Symptom → cause → action

| Symptom | Likely cause | Action |
|---|---|---|
| "Never got the invite email" | Delivery failure, spam, or (historically) rate limit / SMTP outage | **Copy sign-in link**, send it directly. If systemic, see §5. |
| "My link says expired / invalid" | Links are one-time and valid 24 hours (raised from 1h on 2026-06-12); corporate mail scanners can also consume them | **Resend invite email** or **Copy sign-in link**. |
| "I log in and it just asks for a password again" | First-login gate still set (badge: *Password setup pending*) | That screen IS the next step — they set a password once and they're in. If it loops after setting, escalate (gate-clear regression). |
| "Email rate limit exceeded" | `rate_limit_email_sent` exhausted (now 100/hr) | Use **Copy sign-in link** (no email involved); raise the limit in Auth config if onboarding in bulk. |
| Reset email never arrives | As above, or SMTP credentials broken | Copy-link path for the stuck user; verify SMTP per §5. |

## 4. Post-deploy smoke (≈20s)

```sh
SUPABASE_URL=https://qdzgkttiosahdfqresvz.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/auth-smoke.mjs
```

Protocol-checks, against production, with a disposable user it deletes afterwards:
invite-link → verify → session → set password → login · recovery-link → new password → login · gate flag set → clear → login. Exit 0 = all journeys pass.

## 5. Systemic email checks (ops)

- Auth email config lives in Supabase Auth settings: custom SMTP `smtp.resend.com:465`, sender `notifications@buildingops.app`, `rate_limit_email_sent=100`.
- **Never copy a `smtp_pass` value out of a config GET back into a PATCH** — the GET shows a hash that looks real; writing it back breaks all auth email. Rotate by issuing a fresh key in the Resend dashboard and setting it in BOTH the Auth SMTP block *and* the `RESEND_API_KEY` function secret.
- Auth emails (invite/reset/confirm) go through Auth SMTP; `notify-*` edge functions call Resend directly — one can be broken while the other works.
