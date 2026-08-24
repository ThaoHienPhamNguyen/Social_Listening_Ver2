# Social Listening Dashboard

Read-only Next.js dashboard for the social listening tool. Shows today's hot topics (from the discovery layer, sub-project 2a) and recent RSS articles (sub-project 1), split into an Overview view and 3 sector views.

Design spec: [`../docs/superpowers/specs/2026-08-21-dashboard-design.md`](../docs/superpowers/specs/2026-08-21-dashboard-design.md)

Visual redesign (Sidebar/Topbar layout, design tokens ported from a prior version of this project): [`../docs/superpowers/specs/2026-08-24-dashboard-visual-redesign-design.md`](../docs/superpowers/specs/2026-08-24-dashboard-visual-redesign-design.md)

## Local development

```bash
npm install
cp .env.example .env.local   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run dev
```

Get both values from the Supabase project dashboard → Project Settings → API. `SUPABASE_SERVICE_ROLE_KEY` is the **service_role** secret, not the anon/public key — this app relies on it to bypass RLS (both `articles` and `candidate_topics` have RLS enabled with zero policies defined, so the anon key cannot read either table).

## Deployment (Vercel)

1. Import this repository into Vercel.
2. Set **Root Directory** to `dashboard/` in the project's Vercel settings — this is a separate app from the root project's ingestion scripts.
3. Add the two environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) in Vercel's Project Settings → Environment Variables. **Do not** prefix them with `NEXT_PUBLIC_` — they must stay server-only.
4. Deploy. No build command overrides needed (`next build` / `next start` are Vercel's Next.js defaults).

## Scope

See the design spec for what's in and out of scope. Notably out of scope for this version: sentiment, historical/time-series charts, per-topic detail pages, authentication, and any data from Apify (sub-project 2b, not yet built).

## Known pending items

- **Not mobile-responsive.** The Sidebar added in the 2026-08-24 visual redesign is a fixed 232px column with no breakpoint — on narrow viewports the content column gets cramped (~143px). Deliberately deferred: usage right now is desktop-first, so this was accepted rather than fixed. Revisit if/when mobile viewing becomes a real usage pattern.
