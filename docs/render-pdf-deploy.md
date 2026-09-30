# PDF routes on Render

`GET /api/v1/quotations/:id/pdf` answers **503 `PDF_RENDERER_UNAVAILABLE`** on the
deployed backend while working on a laptop, and the print view keeps working.

## Why the print view works and the PDF does not

They are two different code paths, which is the clue that the application is fine
and only the browser is missing:

| Route | Who renders it |
|---|---|
| `/quotations/:id/html` (what **Print** opens) | your own browser, on the page |
| `/quotations/:id/pdf` (what **Download** calls) | headless Chrome, on the server |

So the 503 means only one thing: **the server could not start Chrome.** Locally it
does start, because the machine has one.

Three causes, in the order they usually turn up:

1. **Chrome starts and then dies.** A container gets 64 MB of `/dev/shm` by
   default, which is not enough to lay out an A4 sheet. Chrome needs
   `--disable-dev-shm-usage`. Windows has no `/dev/shm`, so a laptop never hits
   this — and the config's `.env` default listed only the two sandbox flags, so
   the flag was never passed. **This is the most likely cause and it is fixed in
   the code.**
2. **Chrome was never downloaded.** Puppeteer fetches it during `npm install`;
   it goes to a cache directory, and if that directory does not survive the build
   into runtime, there is no browser at runtime.
3. **The libraries Chrome links against are missing.** Debian's `slim` images and
   Render's native runtime do not carry `libnss3`, `libgbm1`, `libatk-*` and
   friends. The browser binary is there and cannot execute.

## Which one is it? The API now says

The 503 carries the first line of Chrome's own message, which identifies the case
outright:

```json
{
  "success": false,
  "error": {
    "code": "PDF_RENDERER_UNAVAILABLE",
    "message": "The document renderer is unavailable. Chrome could not be started on the server.",
    "details": {
      "reason": "Could not find Chrome (ver. 151.0.7922.71)…",
      "executablePath": null,
      "platform": "linux"
    }
  }
}
```

| `details.reason` starts with | Cause | Fix |
|---|---|---|
| `error while loading shared libraries` | 3 | Docker (below) |
| `Could not find Chrome` | 2 | Cache directory (below) |
| `Failed to launch the browser process` | 3 | Docker (below) |
| `Timed out` / `DevToolsActivePort` | 1 | Already fixed — redeploy |
| `No usable sandbox` | — | Keep `--no-sandbox`, it is in the defaults |

The same line is in the service log, and the resolved browser path is logged
once at the first render, so a failed deploy is diagnosable without shell access.

---

## Route A — keep the native Node runtime

Redeploy first. With the launch flags fixed, cause 1 is resolved on its own.

If `details.reason` then says `Could not find Chrome`, point the cache somewhere
that survives the build. In **Settings → Environment**:

```
PUPPETEER_CACHE_DIR = /opt/render/project/src/.cache/puppeteer
```

and in **Settings → Build & Deploy → Build Command**:

```bash
npm install && npx puppeteer browsers install chrome
```

The second command is what makes the browser explicit rather than relying on the
install script having run. Neither needs a code change.

If `details.reason` then reports missing **shared libraries**, the native runtime
cannot be fixed — there is no root to `apt-get` with. Use Route B.

## Route B — Docker (reliable, and the supported way to add system packages)

The repository now carries `backend/Dockerfile`, which installs the libraries
Chrome needs and lets Puppeteer download the browser build that matches
`package.json`. In **Settings**:

| Setting | Value |
|---|---|
| **Language / Runtime** | `Docker` |
| **Dockerfile Path** | `backend/Dockerfile` |
| **Docker Build Context Directory** | `backend` |
| **Docker Command** | *(leave empty — the image's `CMD` is used)* |

Everything else — environment variables, the database URL, the start behaviour —
carries over unchanged; the image ends with `npm start`, the same command the
native runtime ran.

Chrome's version is deliberately the one Puppeteer downloads rather than the
distro's `chromium`. They have to agree: Puppeteer drives Chrome over a debugging
protocol, and a browser a dozen major versions behind is where layout differences
come from.

### Verifying

After either route, hit the PDF route again. A healthy deploy returns the PDF.
If it still fails, `details.reason` has moved on and the table above says what to
do next.

---

## Two things worth knowing

**Set `NODE_ENV=production` on the service.** Right now the error responses carry
a `stack` field, which the error handler only adds when `NODE_ENV` is not
`production`. On a public backend that leaks file paths and internal structure to
anyone who asks. `config/env.js` loads `.env.production` when it is set, but
Render's environment variables take precedence, so the dashboard values still win.

**A browser is memory-hungry.** Chrome holds ~150–250 MB per instance while a
sheet renders. On a small Render instance the render can be the thing that pushes
the process over, and the symptom is a restart rather than a 503. The renderer
already reuses one browser and closes it after 120 idle seconds, so this only
matters under concurrent downloads.
