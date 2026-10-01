# Email from a deployed instance

_Why "Create agent" hangs for two minutes and no welcome mail arrives, while the
same flow works on a laptop._

## The two halves behave differently

| | Laptop | Deployed host |
|---|---|---|
| Can open a TCP connection to `smtp.gmail.com:465` | yes | **no, on a free Render instance** |
| What the failure looks like | — | the connection is **dropped**, not refused |

A dropped SYN is the important detail. Nothing replies, so the send does not fail —
it *hangs* until a timeout fires. Nodemailer's defaults are:

| Option | Default |
|---|---|
| `dnsTimeout` | 30 s |
| `connectionTimeout` | **2 minutes** |
| `greetingTimeout` | 30 s |
| `socketTimeout` | **10 minutes** |

`createAgent` awaits the send (`agent.service.js`), so those two minutes are the
admin's HTTP request. That is the "it takes very long and the email never comes".

## What is fixed in the code

`email.service.js` now sets all four timeouts (10 s / 10 s / 10 s / 20 s) on the
transport, so a filtered port fails in about **ten seconds** instead of two
minutes, and the reason handed back to the admin says what to do about it instead
of only `connect ETIMEDOUT …`. The `/agents` screen's **Test connection** button
(`POST /agents/email-test`) runs through the same transport, so it reports the
same thing without sending mail.

This makes the failure *fast and legible*. It does not make a blocked port work.

## The three things that can be wrong, in the order to check them

1. **Email is switched off on the server.** `EMAIL_ENABLED` must be the literal
   string `true` — `config/env.js` compares with `=== 'true'`, so `True`, `1` and
   `yes` all leave it off. The `/agents` page shows a banner when this is the case
   (`GET /agents/email-status`), and it is the fast failure: no network is touched.
2. **Some of the SMTP settings are missing.** `isEmailConfigured()` needs
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASSWORD` — all four.
   `SMTP_USER` falls back to `SMTP_FROM`.
3. **The host blocks outbound SMTP.** Render blocks ports 25, 465 and 587 on free
   web services; a paid instance type is not affected. This is the one that hangs
   rather than failing, and it is the one no code change can fix.

### Reading the error when it is this one

The message misleads in a way worth knowing. A live failure looked like this:

```
code: 'ESOCKET',
err: 'connect ENETUNREACH 2607:f8b0:400e:c0a::6c:465 - Local (:::0)'
```

That reads as an IPv6 problem, and IPv6 is not why the mail cannot leave.
`nodemailer` resolves **both** families and keeps the unused one as a fallback
(`shared/index.js`), so the reported error is the **last** attempt: IPv4 to
`smtp.gmail.com:465` was dropped silently by the host — consuming the whole 10 s
`connectionTimeout` — and only then did the IPv6 fallback fail instantly with
`ENETUNREACH`, because the container has no IPv6 route. Two facts, one message, and
the one that matters is the ten-second timeout.

The timestamps are the tell: `18:23:06` when the transport was built, `18:23:16`
when the send failed.

Note that `.env` is **not** deployed (`gitignore`), so on the host every value has
to come from the dashboard. `config/env.js` loads env files with `override: true`,
which means an env file that *is* committed would win over the dashboard — the
reason the `.env.*` variants are ignored as well.

## Links in the email pointed at localhost

A separate defect, found while reading a deployed service's environment:

| Variable | Value on the service |
|---|---|
| `CLIENT_URL` | **not set** |
| `CORS_ORIGIN` | `http://localhost:3000,https://<frontend>.vercel.app/` |

Every email carries a "sign in here" link built from `CLIENT_URL`, and it fell back
to the **first** `CORS_ORIGIN` entry when that was unset — which is localhost,
because that is what development needs. So each welcome mail told a new agent to
sign in at a developer's machine.

Set `CLIENT_URL` on every deployed instance. The fallback no longer takes `[0]`
blindly — it skips a localhost entry, so the link is right even without the
variable — but the variable is what should decide it, and the boot log warns when it
is missing.

## "Another project sends mail from Render — why does this one not?"

A single send failure cannot answer that. `nodemailer` resolves both address
families, tries one and then the other, and reports only the **last** attempt — so
one error stands for several different causes. Compare the two services instead:

| Fact to compare | Where to look |
|---|---|
| Instance type (Free / paid) | Render → the service → Settings |
| Region | same page |
| `SMTP_PORT`, `SMTP_SECURE`, `SMTP_SERVICE` | Environment |
| Whether it uses SMTP at all, or an HTTPS API | Environment: a key like `RESEND_API_KEY`, `BREVO_API_KEY`, `SENDGRID_API_KEY` |
| Age of the service | Events: the SMTP block was rolled out on a date, and a service created before it may predate it |

### What a working project actually does differently

A second project of ours (`rentease_backend`) sends from the same Gmail account on a
deployed host. Its transport, read from its source:

```js
nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,   // ← defaults to 587
  secure: process.env.SMTP_SECURE === 'true',     // ← false unless asked
  auth: { user, pass }, pool: true, …
});
```

Three differences matter, and the library version is not one of them — nodemailer 8
there and 10 here resolve both address families the same way (both checked:
`isFamilySupported`, a random pick from the resolved list, `dns.lookup` fallback):

1. **No `service` preset.**
2. **The port comes from the environment and defaults to 587** — STARTTLS.
3. `secure` is false unless the environment says otherwise.

So it speaks STARTTLS on 587 where this project speaks implicit TLS on 465. On a
host that filters one of those ports, that single difference decides which project
can send mail — which is precisely the reading `GET /health/mail` produces, since it
probes 587 as well as the configured port.

### Two traps that made changing the port look useless

Both were in our own code, and both are now handled:

| Trap | What happened | Now |
|---|---|---|
| `service: 'gmail'` | nodemailer merges the preset **after** the caller's options (`smtp-transport/index.js` → `assign(options, urlData, wellKnown(service))`, and `assign` overwrites unconditionally), so the preset's `{ host: 'smtp.gmail.com', port: 465, secure: true }` won and `SMTP_PORT=587` was ignored | `service` is not forwarded while host and port are explicit; the log says when it is ignored |
| `SMTP_SECURE` vs the port | leaving `secure: true` behind while moving to 587 waits for a TLS handshake the server never starts | the port decides — 465 implicit TLS, 587/2525/25 STARTTLS — and a mismatch is logged |

### `GET /health/mail`

The decisive reading, taken from the host that is failing. It opens a plain TCP
connection to the configured mail host on **both** address families and on the
alternative port, and reports each attempt separately:

```json
{
  "host": "smtp.gmail.com", "port": 465, "alternatePort": 587,
  "attempts": [
    { "endpoint": "192.178.211.108:465", "family": "IPv4", "ok": true, "ms": 255 },
    { "endpoint": "2404:6800:...:6d:465", "family": "IPv6", "ok": true, "ms": 253 },
    { "endpoint": "192.178.211.108:587", "family": "IPv4", "ok": true, "ms": 253 }
  ]
}
```

| Reading | Meaning |
|---|---|
| every attempt `ok: true` | the host reaches the mail server — the port is not the problem. An `EAUTH` on the next send means credentials (a Gmail *app password*, not the account password) |
| IPv4 fails, IPv6 `ENETUNREACH` | the failure in this document: the port is filtered and the container has no IPv6 route |
| configured port fails, `:587` succeeds | change `SMTP_PORT` — one filtered port does not mean a filtered host |
| only IPv6 fails | harmless on its own, IPv4 is tried too |

Read-only, and the target comes from the configuration rather than the request, so
it cannot be pointed at anything else — which also means the same JSON can be
fetched from any machine once the deploy is live:

```bash
curl -s https://<api-host>/health/mail
```

One thing to keep honest: the port-blocking claim above comes from Render's
community threads and reports quoting its notice, not from a documentation page
(the one that would settle it returns 404 for us). If a *free* service in another
account can reach `smtp.gmail.com:465`, the rollout is not uniform — an older
service may simply predate it — and the table and endpoint above are the only
honest way to settle which service is which.

## Remedies for a blocked port

| Option | Cost | Code change |
|---|---|---|
| Upgrade the Render instance to any paid type | $ | none |
| Send through an HTTPS email API (Resend, Brevo, SendGrid…) | free tiers exist | a small transport addition |
| Send through an SMTP relay that also listens on **port 2525** | free tiers exist | none — env only |

The third is the cheapest way out on a free instance: only 25/465/587 are blocked,
so pointing `SMTP_HOST`/`SMTP_PORT` at a relay's 2525 endpoint works with the
existing code. Check the provider's own port table first.

## Verifying

After a change, in this order:

0. `GET /health/mail` → every attempt should read `ok: true`. If it does not, stop
   here: no environment variable will get past a port the host cannot reach.
1. `/agents` → the warning banner should be gone.
2. **Test connection** → `SMTP connection is working`.
3. Create a test agent → the response says the credentials were emailed, and the
   temporary password is *not* returned (it is only returned when the mail failed).

In the host's log, `Email send failed` carries the `code` (`ETIMEDOUT`,
`ECONNREFUSED`, `EAUTH`…). `EAUTH` means the port was reached and the credentials
were refused — a different problem, with a different fix (a Gmail app password, not
the account password).
