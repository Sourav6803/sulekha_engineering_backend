# Backend image for hosts that cannot give the native Node runtime a browser.
#
# The quotation and agreement PDFs are printed by headless Chrome, and Render's
# native Node runtime has no browser and no way to install the libraries one
# links against — so those routes answer 503 there while the HTML ones (which the
# browser prints itself) keep working. Docker is the supported way to install
# system packages on Render, which is what this file is for.
#
# Chrome itself is NOT installed here. Puppeteer downloads the build that matches
# the version in package.json, and driving a distro Chromium that is a dozen major
# versions behind it is how you get subtle layout differences — the pair has to
# agree. What this file adds is the shared libraries Chrome needs to run at all,
# plus the fonts, neither of which the slim image carries.
#
# `chromeLaunch.js` finds the downloaded browser on its own, so no
# PUPPETEER_EXECUTABLE_PATH is needed. Only set that variable if you point the
# service at a browser you installed yourself.

FROM node:22-bookworm-slim

ENV NODE_ENV=production

# Chrome's runtime dependencies (Debian bookworm names), and the fonts.
#
# fonts-liberation is what the sheet's body text falls back to; fonts-noto-core
# covers Bengali, which the consumer-facing notices are written in, and without
# it those characters print as empty boxes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-liberation \
      fonts-noto-core \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libexpat1 \
      libfontconfig1 \
      libgbm1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxkbcommon0 \
      libxrandr2 \
      libxrender1 \
      libxshmfence1 \
      libxss1 \
      wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a code-only change reuses this layer. The lockfile is
# copied explicitly because `npm ci` requires it.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Render sets PORT and routes to it; the app reads PORT from the environment.
EXPOSE 3000

CMD ["npm", "start"]
