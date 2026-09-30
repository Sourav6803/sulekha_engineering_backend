# CORS on a deployed instance

_Why the deployed frontend reports a CORS error while the same code works locally._

## The symptom, read from the wire

```
$ curl -i -X OPTIONS https://<api>/api/v1/auth/login \
    -H "Origin: https://<frontend>.vercel.app" \
    -H "Access-Control-Request-Method: POST"

HTTP/1.1 204 No Content
access-control-allow-credentials: true
access-control-allow-headers: Content-Type,Authorization,X-Requested-With
access-control-allow-methods: GET,POST,PUT,DELETE,PATCH,OPTIONS
vary: Origin
                     ← no access-control-allow-origin
```

`allow-credentials`, `allow-methods` and `vary: Origin` are all present, and the
allow-origin is missing. That combination is not "CORS is misconfigured somewhere";
it is one specific thing: the middleware ran, and the request's origin was **not in
the list**, so it emitted no `Access-Control-Allow-Origin` and the browser refused
the response.

## Why that happened even though CORS_ORIGIN was unset

`config/env.js` splits the value:

```js
CORS_ORIGIN: validated.CORS_ORIGIN.split(',').map(s => s.trim()),   // always an array
```

and the environment default is the string `'*'`. So an unset variable did not
reach the middleware as `'*'`, it reached it as `['*']` — and the `cors` package
treats a **string** `'*'` as "any origin" but an **array** as an exact-match list
(`isOriginAllowed` in `lib/index.js` compares each entry with `===`). No request
origin is ever equal to the string `'*'`.

The result: the configuration that reads as "allow everything" refused *every*
origin, and only in production — development uses a bare `cors()`, which is why a
laptop never showed it.

It is reproducible in isolation:

```js
cors({ origin: ['*'], credentials: true })   // → no ACAO for any origin
cors({ origin: true,  credentials: true })   // → ACAO reflects the request origin
```

## What the code does now

`src/config/cors.js` owns the policy and passes the middleware what it expects:

| Configuration | `origin` handed to `cors` | Effect |
|---|---|---|
| unset, or `*` | `true` | reflects the request origin (the only correct way to combine a wildcard with credentials — browsers reject `*` on a credentialed request) |
| `https://a.com,https://b.com` | the array | exact match against the list |
| empty | `[]` | refuses everything, and the boot log says so |

It also strips a trailing slash from each entry. A browser's `Origin` header never
carries one, so `https://x.vercel.app/` was a configured origin that could never
match — which is what `.env.local` had.

Two log lines back this up on a host where the only other evidence is a browser
console:

- at boot: `CORS allowed origins: …` (or a warning when the value is unset), so a
  broken policy is visible before anyone opens the frontend;
- on each refusal: a warning naming the origin and listing what is allowed, once per
  origin.

## What to set

In the host's environment (Render → the service → **Environment**), one variable:

```
CORS_ORIGIN = https://<frontend>.vercel.app
```

Comma-separate for more than one, and **no trailing slash**:

```
CORS_ORIGIN = https://sulekha-engineering-frontend.vercel.app,http://localhost:3000
```

`CORS_ORIGIN` is not optional on a deployed instance: `.env` is gitignored, so
every value has to come from the dashboard.

### Vercel preview deployments

Each preview build gets its own hostname (`sulekha-engineering-frontend-git-<branch>-<team>.vercel.app`),
which cannot be listed in advance. List the ones you use, or allow the wildcard and
accept that any origin is reflected — note the boot warning if you do.

## Verifying

1. Restart or redeploy the service, and read the boot log line for `CORS allowed origins`.
2. Re-run the `curl` at the top: `access-control-allow-origin` should now be the
   origin you sent, and the browser error should be gone.
3. A wrong origin should still be refused — that is the check that this is still an
   allow-list and not merely "CORS is off".
