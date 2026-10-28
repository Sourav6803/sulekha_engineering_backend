# Sulekha Engineering — backend system design

How the API is put together, where each decision lives, and why some of it looks the
way it does. Read this before changing a module; the comments in the files explain
individual lines, this explains the shape.

Last revised: 2026-10-27.

---

## 1. What the system is

A PM Surya Ghar rooftop-solar ERP for one vendor in West Bengal. The domain is a
single pipeline, and every step is a record:

```
customer → application (documents) → office verification → quotation + agreement
        → signed scans back → scheme documents → installation → site evidence → completion
```

The backend is the source of truth for that pipeline. The frontend (a Next.js app in
`../client`) only renders and submits; nothing is computed there that matters.

Two properties drive most of the design decisions:

1. **Field agents work offline-ish and far away.** Three districts, ~100 km apart, one
   bar of network. Requests must be idempotent where it counts (purchases carry
   `idempotencyKey`), and a double tap must not create two records.
2. **Documents are the deliverable.** Quotation, agreement, and the scheme paperwork
   are printed, signed, scanned and filed. Files are first-class records with
   provenance, not blobs on a page.

---

## 2. Runtime topology

```
Next.js client ──HTTPS──▶ Express API ──▶ MongoDB (source of truth)
                              │
                              ├─▶ Redis        cache only, never truth
                              ├─▶ BullMQ       optional workers (pdf, low stock)
                              ├─▶ Cloudinary   file storage (local ./uploads as fallback)
                              ├─▶ Puppeteer    HTML → PDF (quotation, agreement)
                              └─▶ SMTP/Twilio  notifications (both optional)
```

Everything except MongoDB degrades rather than fails:

| Dependency | If it is down | Where |
|---|---|---|
| Redis | cache misses, requests still answer. It also holds the `refresh_token:<userId>` record that logout deletes, so losing Redis means a logged-out refresh token is not even nominally revoked (see §13) | `config/redis.js`, `utils/cache.js` |
| BullMQ | jobs run inline or not at all; API unaffected | `jobs/queue.js` |
| Cloudinary | local disk under `UPLOAD_DIR` | `services/storage.service.js` |
| Puppeteer | PDF routes answer 503, everything else works | `services/pdfBrowser.js` |
| SMTP / SMS | notices are logged, not sent | `services/notification.service.js` |

That asymmetry is deliberate: the shop must be able to take a customer's documents
while the mail server is having a bad day.

---

## 3. Layering and request lifecycle

```
routes/          URL + method + auth + role + validation   (no logic)
controllers/     HTTP in, HTTP out; parse query, call service, send response
services/        business rules, transactions, cross-model effects
models/          schema, indexes, instance/static helpers
validations/     request schemas, one file per resource
```

`app.js` mounts middlewares in this order, and the order is load-bearing:

```
helmet → cors → json/urlencoded (10 MB) → cookieParser → compression
       → morgan + timing logger → rateLimiter → /health* probes → routes
       → 404 → errorHandler
```

- Rate limiting is applied to **all** routes before they are mounted, so a new router
  is protected by default.
- `/health`, `/ready`, `/live`, `/health/renderer`, `/health/mail` are registered
  before the API router and need no auth. The renderer and mail probes exist because
  a broken Chrome or a blocked SMTP port is invisible in a build log; both always
  answer `200` so a health checker pointed at them never restarts the instance it is
  inspecting.

Every route handler is wrapped in `asyncHandler` so a rejected promise reaches
`errorHandler` instead of hanging the request.

---

## 4. Configuration

All configuration is read once, validated with zod, and exported as a frozen object
from `config/env.js`. Nothing else in the codebase touches `process.env`. Adding a
variable means adding it there — an unvalidated `process.env.X` is how a typo becomes
a silent `undefined` at 2 a.m.

Groups (see the file for the full list and defaults):

| Group | Notable keys |
|---|---|
| Server | `NODE_ENV`, `PORT` (default `3000`), `HOST`, `API_PREFIX` (`/api/v1`) |
| Mongo | `MONGO_URI`, `MONGO_READ_PREFERENCE` (default `primaryPreferred`), pool sizes |
| Redis | `REDIS_HOST/PORT/DB`, `REDIS_KEY_PREFIX`, `REDIS_TLS` |
| Auth | `JWT_SECRET` (min 32 chars), `JWT_EXPIRES_IN` (`7d`), `JWT_REFRESH_EXPIRES_IN` (`30d`) |
| CORS | `CORS_ORIGIN`, `CORS_CREDENTIALS`, `CORS_MAX_AGE`, `CLIENT_URL` |
| Upload | `MAX_FILE_SIZE` (5 MB), `ALLOWED_FILE_TYPES`, `UPLOAD_DIR` |
| Storage | `CLOUDINARY_*`, `AWS_*` |
| Mail / SMS | `SMTP_*`, `EMAIL_ENABLED`, `TWILIO_*`, `SMS_ENABLED` |
| Queue | `BULL_REDIS_*`, `ENABLE_QUEUE_WORKERS` (default `false`) |
| PDF | `ENABLE_PDF_GENERATION`, `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_TIMEOUT` |
| Ops | `LOG_LEVEL`, `LOG_DIR`, `SENTRY_DSN`, `PROMETHEUS_ENABLED` |

`ENABLE_QUEUE_WORKERS` defaults to false on purpose: BullMQ workers poll Redis
continuously and will drain a metered plan for no benefit on a single-instance
deploy. Turn it on when there is more than one API process.

---

## 5. Authentication and authorization

### Tokens

- Access token: JWT, `HS256`, 7 days, sent as `Authorization: Bearer <token>`.
- Refresh token: JWT, 30 days, signed with the same secret. `POST /auth/refresh-token`
  verifies the signature and that the user still exists and is active, then issues a
  **new access token only** — the refresh token is neither rotated nor checked against
  storage. Treat it as a long-lived bearer credential until §13 is addressed.
- `authenticate` verifies the token, then **loads the user from MongoDB** (password
  excluded). The DB read on every request is intentional: a deactivated account or a
  changed role takes effect immediately rather than in seven days.

### Permissions

`hasPermission('edit_installation')` resolves in this order (`data/rolePermissions.js`):

1. An explicit `user.permissions` array — a deliberate per-account override, wins.
2. Otherwise the role's floor from `ROLE_PERMISSIONS`.
3. Somebody in the installation department also gets the crew floor unioned in.

Floors:

| Role | Floor |
|---|---|
| `admin` | `*` (wildcard, bypasses every check) |
| `manager` | customers, installations, materials, purchases, `generate_pdf` — everything but user administration |
| `agent` | own customers (view/create/edit), `view_installation`, `generate_pdf` |
| `installation_team` | `view_installation`, `edit_installation`, `generate_pdf` |

The crew has no money, stock or paperwork permission by design: they read the job
they are on and write evidence.

### The role/department rule

**An account's access is `role` + `department`, never `role` alone.**

The `department` field shipped before the `installation_team` role, so installers in
the database are `role: 'agent'` with `department: 'installation'`. Branching on
`role` alone gave them the sales dashboard and 403'd them out of the evidence
endpoints. Every check therefore goes through `isInstallationCrew(user)`, which
accepts either spelling; `authorize()` maps a crew account to `installation_team`
before comparing. Any new gate must do the same — this has already caused one
production-shaped bug.

---

## 6. Domain model

| Model | Natural key | Belongs to / references |
|---|---|---|
| `User` | `employeeId` | `createdBy`, `updatedBy` |
| `Customer` | `SE-0001` | `ownerAgent` → User |
| `Application` | `SE/APP/2026/0001` | `customer` |
| `Quotation` | serial (`quotationNumber`) | `customer`, `application` |
| `Agreement` | serial | `customer`, `application`, `quotation` |
| `Installation` | `INST-2026-0001`, `PRJ-2026-0001` | `customer`, `application`, `teamAssigned[].member` → User |
| `Material` | `MAT-0001` | `preferredSupplier` → Supplier |
| `Purchase` | `purchaseId` | `supplier`, `items[].material` |
| `StockLedger` | — | `material`, `installation` (flexible schema) |
| `BOMTemplate` | — | — |
| `Notification` | — | `recipient` → User |
| `Lead`, `ProjectShowcase`, `SiteBanner`, `CompanyProfile` | — | public site |
| `Counter` | `_id` = counter name | — |

**Serial numbers are generated by `Counter`**, one document per series, incremented
atomically with `findByIdAndUpdate(..., { $inc })`. Two agents saving at the same
moment cannot receive the same number; a timestamp-based scheme cannot promise that.

**Snapshots.** `Installation` stores `customerNameSnapshot` and
`customerPhoneSnapshot`; `Purchase` stores `supplierNameSnapshot`. A printed document
must still read correctly after the customer is renamed or the supplier is deleted.

**Soft delete** everywhere: `isActive: false`, filtered out by list queries. Nothing
is hard-deleted except files replaced by a newer issue of the same document.

`StockLedger` is intentionally `strict: false` — it was introduced after stock had
already moved, and the entries vary by movement type (purchase in, installation out,
manual adjustment, reversal). Treat its shape as append-only history, not a schema.

---

## 7. Workflow state machines

Transitions are declared in data, not in controllers, so a stale tab or a double
click cannot skip a step.

### Application (`data/applicationChecklist.js`)

```
draft → submitted → under_review ─┬→ approved → quotation_issued → agreement_issued → completed
                                  ├→ correction_required → submitted
                                  └→ rejected
```

`STATUS_TRANSITIONS` is the allow-list; `application.service.js` refuses anything not
listed with a 422. `statusHistory[]` records who moved it, when, and with what note.

Document kinds (`CHECKLIST_DOCUMENTS`) split by who may file them:

- **Consumer intake** — `aadhaar`, `panCard`, `electricBill`, `rooftopPhoto`,
  `landRecord`, `passbookOrCheque`
- **Office filed** — `feasibilityReport`, `rtsReport`, `loanLetter`, `dcrCertificate`,
  `etoken`, `netMeteringAgreement`, `acknowledgement`
- **Issued by us** — `issuedQuotation`, `issuedAgreement`
- **Signed scans** — `signedQuotation`, `signedAgreement`
- `other`

A field agent can view and download office-filed documents but cannot file one —
`OFFICE_FILED_DOCUMENT_KINDS` is exported and sent to the client so neither side
hardcodes the list.

### Quotation (`models/Quotation.js`)

`draft → sent → accepted | rejected | expired`, plus `converted` once an agreement
exists. Two types, `consumer` and `partner`, with different defaults
(`data/quotationTypes.js`). The issued PDF is a template rendered from stored line
items — never recomputed at print time.

### Installation (`models/Installation.js`)

`pending_quotation → quoted → scheduled → in_progress → completed`, plus `cancelled`.

Evidence gates the last step. Before `completed`, all of the following must exist:

- every panel unit has a serial number
- every panel unit has a photo
- two site photos: the array and the new meter
- inverter brand, serial and photo
- (recorded, not blocking) inverter capacity in kW, marketing photo

Material lines carry their own lifecycle: `reserved → installed → reversed`.

---

## 8. Module notes

| Module | What it owns |
|---|---|
| `auth` | login, refresh, logout, password change, profile; refresh tokens in Redis (see §13) |
| `agent` | account management for field staff (admin only), scoped listing |
| `customer` | intake, dedupe by phone, electricity-bill portal link, verification state |
| `application` | the state machine above, document upload/replace, checklist endpoint |
| `quotation` | line items, revisions, PDF issue, legacy import (`quotationImport.service.js`) |
| `agreement` | generated text (`utils/agreementText.js`), payment schedule, PDF issue |
| `installation` | application → job, BOM, materials, team assignment, evidence, dashboard |
| `material` | catalogue, stock levels, reversal, usage history from the ledger |
| `purchase` | supplier invoices, idempotent creation, stock-in |
| `bomTemplate` | reusable item sets per system size / roof type |
| `notification` | in-app notifications; email/SMS fan-out lives in services |
| `lead`, `showcase`, `banner`, `public` | anonymous marketing site; management under `/admin` |

### Installation specifics worth knowing

- A job is created **from an application**, not from a raw customer. `GET
  /installations/installable-applications` returns only applications that do not yet
  have one; quotation number, system size and roof type are copied and read-only.
- `projectNo` (`PRJ-YYYY-NNNN`) is generated server-side, never accepted from the
  client.
- `teamAssigned[]` (`member`, `role` ∈ lead/technician/helper/supervisor) is the only
  source of truth for "whose job is this". The list endpoint scopes crew accounts to
  `teamAssigned.member = req.user._id`; `GET /installations/dashboard` returns either
  that subset (`scope: 'mine'`) or the whole pipeline for the office.
- The BOM is office-editable until confirmed; after confirmation, and always for
  crew accounts, the sheet is read-only.

---

## 9. Cross-cutting behaviour

### Caching

`utils/cache.js` wraps Redis with a namespaced key prefix and a JSON envelope. Reads
degrade to a miss. Anything cached must be reconstructible from MongoDB — if it is
not, it does not get cached.

### File handling

`middlewares/upload.js` (multer) validates type and size. Two storage modes exist
side by side: `diskStorage` for the ordinary uploads, and `memoryStorage` variants
for the paths that transform a file in flight (image re-encoding, PDF merge) before
handing it to `services/storage.service.js`, which decides destination: Cloudinary
when configured, otherwise `UPLOAD_DIR`. Every stored file keeps its `publicId`/URL so
a replaced document can delete its predecessor instead of leaking it.

### PDF pipeline

`pdfBrowser.js` launches one shared Chromium (`chromeLaunch.js` resolves the
executable, including a project-local cache), renders an HTML template to a buffer,
and reuses the page context where it can. `quotationPdf.service.js` and
`agreementPdf.service.js` own their templates; `documentStorage.service.js` files the
result against the record. If Chrome is missing the route answers 503 with a message
naming what is missing — check `GET /health/renderer` first.

### Notices

Email/SMS content lives in `data/*.js` (Bengali first, English second) and is sent by
`services/*Notice.service.js`. Every notice is best-effort: a failure is logged and
never rolls back the business action that triggered it. In-app `Notification` records
are written regardless, so the bell icon is a reliable audit of what happened.

### Jobs

`jobs/queue.js` defines the BullMQ queues; `pdfGeneration.job.js` and
`lowStockAlert.job.js` are the workers. Registered only when
`ENABLE_QUEUE_WORKERS === 'true'`.

---

## 10. Error contract

Success (via `ApiResponse.send`, `...Paginated`, `...sendCreated`):

```json
{ "success": true, "statusCode": 200, "message": "Success", "data": {}, "timestamp": "..." }
```

Failure (always shaped by `errorHandler`):

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {} } }
```

Two rules that have already caused bugs:

1. **`ApiResponse.success()` builds a body, it does not send it.** Use `send` /
   `sendCreated` / `sendPaginated` in controllers. A route that calls `success()`
   alone returns nothing and hangs the client.
2. **`ApiError.validation()` is 422, not 400.** MongoDB `ValidationError` is 400,
   duplicate key is 409, `CastError` is 400, JWT problems are 401, multer size errors
   are 400. A test asserting 400 on a zod/Joi rejection will fail for the right
   reason.

---

## 11. Testing

```bash
cd backend
npm test                                   # whole suite, 2 files at a time
npm run test:quotation                     # the quotation subset, quicker
node --test tests/installation.test.js     # one file
```

Tests use `node:test` + `supertest` against the real app instance with an in-memory
or test database (`tests/helpers/testSetup.js`). No HTTP server is started; requests
are dispatched to the exported `app`.

Known red: `tests/application.test.js` and `tests/signedDocumentNotice.test.js` still
create applications with an agent token, which the customer-first flow no longer
allows — the fixtures need rewriting against the office account. Treat those
failures as fixture debt, not as broken behaviour, until they are migrated.

Seed script for a working catalogue: `jobs/seedMaterials.js`.

---

## 12. Running and deploying

```bash
cd backend
npm install
npm run dev      # nodemon, development
npm start        # production
```

Checklist for a fresh host, in the order things usually break:

1. `MONGO_URI` reachable; `JWT_SECRET` at least 32 chars (the app refuses to boot).
2. `CORS_ORIGIN` set to the **frontend origin** in production. Unset does not mean
   "allow all" in every code path — see `config/cors.js`; the server logs the
   resolved policy at boot.
3. `CLIENT_URL` set, otherwise links inside outgoing email fall back to the first
   origin in `CORS_ORIGIN` (usually localhost, which the agent cannot open).
4. Chrome resolvable for PDFs — `GET /health/renderer`, and `PUPPETEER_EXECUTABLE_PATH`
   if it lives somewhere unusual.
5. `EMAIL_ENABLED` / `SMTP_*` — `GET /health/mail` reports each address family and
   port separately, because a single send failure cannot tell "blocked port" from
   "wrong credentials".
6. `ENABLE_QUEUE_WORKERS` only when Redis is meant to be paid for.

`server.js` shuts down gracefully on `SIGTERM`/`SIGINT`: stop accepting connections,
close Mongo, Redis and the queues, then exit — with a 30 s hard timeout.

---

## 13. Known gaps

- **Logout does not revoke a refresh token.** `login` writes `refresh_token:<userId>`
  to Redis and `logout` deletes it, but `/auth/refresh-token` never reads that key — it
  only verifies the JWT signature (see §5). A refresh token captured before logout, or
  before a password change, keeps minting access tokens for its full 30 days. The fix
  is to compare the presented token with the stored value (and clear it on password
  change) — or to add a token version to the user document.
- **Application read access is not scoped to the owner.** `listApplications` filters
  agents to `agent = user._id`, but `getApplication` has its `assertAccess(application, user)`
  call commented out, so an agent who knows an id can read another agent's
  application — including the consumer's address and bill details. Restore it before
  onboarding more agents; the list scoping alone is not a boundary.
- Two test files still encode the pre-customer-first flow (see §11).
- `StockLedger` has no enforced schema, so an entry written with a typo'd field name
  will never be found again by a query on that field.
- Quotation/agreement versioning keeps only the latest issued PDF per kind; earlier
  issues are deleted from storage, not archived.
- No audit trail for permission changes on user accounts: `ENABLE_AUDIT_LOGS` is
  validated in `config/env.js` and read nowhere else.

---

## 14. Recipes

**Add an endpoint**

1. Route in `routes/<module>.routes.js`, with `authenticate`, `authorize(...)`,
   `hasPermission(...)` and `validate(schema)`.
2. Handler in `controllers/<module>.controller.js`, wrapped in `asyncHandler`,
   answering with `ApiResponse.send`/`sendPaginated`.
3. Business rules in `services/<module>.service.js`. If two models change together,
   the transaction belongs in the service, not the controller.
4. A test in `tests/<module>.test.js` using the account shape that exists in the
   database — not the one the schema allows.

**Add a field**

1. Schema in `models/`, with `maxlength`/bounds so bad data is refused at write time.
2. Validation rule if the client supplies it.
3. Service logic only if the field changes behaviour.
4. Client type in `../client/types/` and the form; keep snapshots in mind if the field
   is printed on a document.

**Add a permission**

1. Add the string to the relevant floor in `data/rolePermissions.js`.
2. Guard the route with `hasPermission('...')`.
3. Mirror the gate on the client in `../client/lib/permissions.ts` (frontend hides,
   backend refuses — never the other way round).
4. If the gate differs for the crew, route it through `isInstallationCrew`, not a
   `role` comparison.
