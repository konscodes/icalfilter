# icalfilter

Filter and rewrite events from any iCalendar feed. Paste a feed URL, add rules, and get a new URL with all
settings encoded in it. Subscribe to that URL in any calendar app: each fetch pulls the original feed,
applies your rules and returns a filtered `.ics`.

No database and no dependencies: one static page plus one Vercel function.

## Rules

- **Filtering**: `Remove`/`Keep` events where Title / Description / Location / Any field
  contains / equals / starts with / matches regex a value (case-insensitive).
  Events matching any Remove rule are dropped; if Keep rules exist, an event must match at least one.
- **Replacement**: find and replace text (plain or regex) in Title / Description / Location.
- **Fallback timezone**: added as `X-WR-TIMEZONE` only when the source has no timezone info.
- **Calendar name**: overrides `X-WR-CALNAME`.

## Layout

```
public/index.html   config UI (static)
api/feed.js         GET /api/feed?c=<config>             -> filtered .ics
                    GET /api/feed?c=<config>&format=json -> preview of kept/removed events
lib/ical.js         parsing, filtering, replacement
dev.mjs             local dev server
```

The config is base64url-encoded JSON in the `c` query param. Feeds are cached at Vercel's edge for 15 minutes.

## Run locally

```bash
npm run dev   # http://localhost:3000
```

## Deploy

Import the repo in Vercel (framework preset: **Other**, no build command), or run `npx vercel`.
