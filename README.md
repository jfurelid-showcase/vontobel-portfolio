# Vontobel Portfolio Builder

Three pieces:

```
supabase/               SQL schema (one Supabase project, run once)
scraper-full-list/      Playwright job -> certificates_full, runs daily 17:30 CET via GitHub Actions
quote-worker/           Always-on Node process -> live prices + NAV, deploy to Railway/Fly.io
web/                    Next.js site (Vercel) — dashboard, admin tool, password gate
```

## Before anything else — read this

I could not run a browser against ngm.se from inside this build (my sandbox
can't reach that domain), so I wrote the scraper against the *shape* of the
page you screenshotted rather than its exact DOM. It uses ISIN-pattern
matching and header-text matching rather than fixed CSS classes specifically
so it's likely to survive not having seen the real markup — but you will
probably need one round of tweaking:

1. `cd scraper-full-list && npm install`
2. `HEADLESS=false` isn't wired up as a flag yet — quickest way to check: run
   `npx playwright codegen https://www.ngm.se/market/etp?page=1` locally,
   click around, and confirm the table rows are plain `<tr>`/`<td>` (most
   likely) or something else (e.g. div-based grid with `role="row"`). Update
   the selectors at the top of `scrape-full-list.mjs` / `worker.mjs` if
   needed — both files have comments marking exactly where.

## 1. Supabase

1. Create a project (or use your existing one).
2. SQL editor → paste and run `supabase/migrations/0001_init.sql`.
3. Settings → API → copy the Project URL, `anon` key, and `service_role` key.

I put everything in **one** Supabase project/database, in two logical groups
of tables (`certificates_full` + `scrape_runs` for the daily job;
`portfolio_positions` + `price_ticks` + `nav_history` + `portfolio_settings`
for the live side). A single Postgres database handles a once-a-day writer
and a several-times-a-minute writer without any contention — there's no
real benefit to two separate Supabase projects here, just two more sets of
keys to manage. Say so if you'd rather I split it and I will.

## 2. Daily full-list scraper (GitHub Actions)

1. In your GitHub repo: Settings → Secrets and variables → Actions, add
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. The workflow at `.github/workflows/full-list.yml` is already scheduled
   for 17:30 CET/CEST daily. Trigger it manually once from the Actions tab
   ("Run workflow") to confirm it scrapes successfully before trusting the
   schedule.

## 3. Live quote worker (Railway, Fly.io, or any always-on host)

Vercel can't run this — its functions aren't allowed to run continuously.
Any host that keeps a Docker container alive works:

**Railway**
1. New Project → Deploy from GitHub → point at this repo, root directory
   `quote-worker`.
2. It'll detect the Dockerfile automatically.
3. Add env vars `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally
   `REFRESH_INTERVAL_MS` (default 10000 = 10s).
4. Deploy. Check logs — you should see a `Tick ... NAV=...` line every
   interval once you've added at least one open position.

**Fly.io** — `fly launch` from inside `quote-worker/` (it'll pick up the
Dockerfile), then `fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...`.

## 4. Web app (Vercel)

1. Vercel → New Project → import this GitHub repo, set **root directory to
   `web`**.
2. Environment variables (Project Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SITE_PASSWORD` — the single shared password for the whole site
3. Deploy. Visit the URL, you'll land on `/login`; enter `SITE_PASSWORD`.
4. `/` is the dashboard, `/admin` is where you search an ISIN from the full
   list and add it to the portfolio with entry price, stop loss, target,
   stake size, a note, and the podcast episode it came from.

Note on the password gate: it's one shared password for everyone, including
admin access — anyone with it can add/close positions. That was the
simplest option and matches what you picked; if you later want the admin
tool behind a *second*, stricter password, that's a small addition (a
second cookie check on `/admin` and its API routes) — just ask.

## How NAV / daily / monthly / YTD are computed

Every worker tick appends the whole portfolio's current value to
`nav_history` (indexed, starts effectively wherever your first tick lands —
you can set `portfolio_settings.cash_sek` if you want to seed it against a
starting capital figure). The dashboard compares the latest NAV to the
`nav_history` row closest to the start of today / this month / this year
(`lib/nav.ts`), all in Europe/Stockholm time.

## What's deliberately left simple / left to you

- The scraper's column-mapping is defensive but unverified against the live
  DOM — budget one short debugging pass.
- `stake_sek` (position size) defaults to 10,000 SEK if you don't set it;
  it's just the weight used for NAV — change it per position in the admin
  form.
- Realtime is on (`supabase_realtime` publication in the migration), so the
  dashboard updates the instant the worker writes — no page refresh needed.
