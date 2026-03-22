# Architecture

## Current path: static-first simulation

This repository targets **GitHub Pages**, so the shipped architecture is intentionally **client-only**:

- React + Vite front end
- Pure in-browser simulation engine
- Seeded deterministic randomness for replay and balancing
- Local persistence via `localStorage`
- AI rivals in place of live multiplayer peers

This lets the project stay deployable on static hosting while still supporting:

- repeatable balancing work
- local playtesting
- smoke testing against the built bundle
- post-match summaries

## Why it is not server-authoritative

The original design doc called for a real-time, server-authoritative economy. GitHub Pages cannot host:

- authoritative game state
- player matchmaking
- anti-cheat enforcement
- synchronized multiplayer tick resolution
- persistent shared lobbies

Those constraints are why this build treats multiplayer-adjacent systems as simulated:

- AI opponents instead of networked players
- trust-based social systems resolved locally
- deterministic seeds instead of replicated server timelines

## Current code shape

- `src/game/data.ts`
  Economy constants, board data, jobs, AI roster, and default config.
- `src/game/engine.ts`
  Core simulation logic: ticks, rounds, events, debt, ownership, trust, summaries, and deterministic RNG.
- `src/App.tsx`
  Lobby, gameplay UI, onboarding, persistence wiring, and finish-state presentation.
- `src/storage.ts`
  Browser persistence for draft settings, saved games, tutorial dismissal, and last-match summaries.
- `src/game/engine.test.ts`
  Deterministic engine coverage.
- `scripts/smoke.mjs`
  Fast browser smoke check against the built app.

## If the project stays static-hosted

Lean further into:

- stronger AI archetypes
- more replay/debug tooling
- sandbox modes and scenarios
- richer summaries and balancing instrumentation
- local challenge seeds

## If the project moves to real multiplayer

The clean break is a new authoritative backend, not incremental hacks into the current static build.

Recommended split:

1. Keep the current React app as the presentation layer.
2. Extract the simulation into a shared rules package.
3. Build a realtime game server that owns the tick loop.
4. Replace local AI players with websocket-connected clients.
5. Move persistence, matchmaking, and replay storage to backend services.

At that point the seeded local simulation remains useful as:

- a balance sandbox
- a deterministic regression harness
- an offline single-player mode
