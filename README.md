# Rent Is Due

Static React prototype of **GEN Z MONOPOLY**, built with Vite and designed to deploy cleanly to GitHub Pages.

## What this build includes

- Real-time tick loop with accelerated pacing for browser play
- Seeded deterministic runs for replay and balancing
- Debt, interest, credit score, stability, and soft-bankruptcy survival mode
- Jobs, gig work, passive income, inflation, global events, and personal events
- Market-owned properties with late-game buyout windows
- Roommate pacts, trust-building support actions, and trust-based bridge loans
- Owned-property upgrades and strategy toggles
- Round summaries plus local persistence for draft settings and last match
- AI rivals so the game works without a backend

## Why this is client-only

The original concept called for a server-authoritative multiplayer economy. GitHub Pages cannot host that architecture directly, so this implementation adapts the design into a **single-page local simulation** with AI opponents while preserving the core pressure loop.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

## Verification

```bash
npm run lint
npm test
npm run smoke
```

`npm run smoke` builds the app, serves the static bundle locally, and runs a headless browser sanity check.

## Project docs

- Task tracking: [`TASKLIST.md`](./TASKLIST.md)
- Architecture notes: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)

## GitHub Pages deployment

This repo includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

To publish:

1. Push to the `main` branch.
2. In GitHub, open `Settings > Pages`.
3. Set the source to `GitHub Actions`.

The Vite `base` path is derived automatically from `GITHUB_REPOSITORY`, so the build will serve correctly from the repository subpath on Pages.
