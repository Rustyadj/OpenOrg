# OpenClaw Command Center

Glassmorphism React/Vite dashboard shell for OpenClaw.

## What changed before shipping

- Added a real gateway API integration point (`VITE_API_BASE_URL`) with live status polling.
- Added a top-level React error boundary so one bad component does not nuke the whole app.
- Added Firebase auth scaffolding with a hard stop when auth is not configured.
- Added a demo-auth escape hatch for local previews only (`VITE_ALLOW_DEMO_AUTH=true`).
- Added mobile nav handling so the shell is usable on smaller screens instead of instantly breaking.
- Fixed package compatibility by pinning React 18 so installs/builds work with the current dependency tree.

## Still not fully production-ready

This repo is now in a safer state, but you still need to finish these before a real launch:

1. Replace page-level mock datasets with real gateway/domain data.
2. Decide and implement the exact auth policy (Google-only, email/password, org SSO, etc.).
3. Add route/page-level loading, empty, and error states inside major feature panels.
4. Profile the heavy dashboard/workflow/metrics pages with real payload sizes.
5. Tighten mobile layouts inside individual pages — the shell is responsive now, but many dense desktop panels still need layout work.

## Setup

```bash
cp .env.example .env
npm install
npm run build
npm run dev
```

## Environment

See `.env.example`.

Minimum for a real deployment:

```bash
VITE_API_BASE_URL=https://your-gateway.example.com
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_ALLOW_DEMO_AUTH=false
```

For local-only demo mode:

```bash
VITE_ALLOW_DEMO_AUTH=true
```

## Notes

- The dashboard now tries `/health` and `/status` on the configured gateway base URL.
- If those endpoints differ in your backend, update `src/lib/api.ts`.
- Firebase is scaffolded but intentionally not optional in production mode.
