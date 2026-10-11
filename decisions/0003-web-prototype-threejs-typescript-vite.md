# 0003. The web prototype is three.js + TypeScript + Vite
Date: 2026-10-11 · Status: **accepted**

## Context
Magic Forest stands or falls on how it looks. A bird seen from behind flies over open ground,
and the forest it sows has to grow organically: trunks extend, branches fork, leaves unfurl and
blossoms glow. It must not simply scale up. That means a real 3D chase camera, procedurally
generated geometry that changes every frame, many small emissive particles, and a bloom pass
for the glow. The prototype has to run in a phone browser from a link (ADR 0002).

## The question
Which stack does `web/` use to sketch it?

## Decision
**three.js + TypeScript + Vite**, with exact pinned versions in `web/package.json`.

- three.js renders the scene. Its `EffectComposer` + `UnrealBloomPass` provide the glow.
  Growth is procedural geometry that we write ourselves (e.g. L-systems or space colonization).
- TypeScript keeps the growth and tuning code readable as the sketch grows.
- Vite serves it with hot reload and builds a static `dist/` for GitHub Pages
  (`.github/workflows/pages.yml`).

## Alternatives considered
- **Vanilla JS + three.js, no build**: the same renderer and zero tooling. But it has no types
  for the fiddly growth maths, and import maps get awkward as files multiply. Rejected on merit.
- **Babylon.js**: built-in glow layer and particle systems. It is a heavier engine with more
  opinions than a sketchpad needs. Most of the work here is custom procedural geometry, which
  it doesn't help with. Rejected on merit.
- **2D (Pixi / Phaser)**: a pseudo-3D behind-the-bird view is possible, but branching growth
  seen in depth is the core of the pitch, and 2D fakes it badly. Rejected on merit.

## Consequences
- `cd web && npm ci && npm run dev` runs the prototype. `npm run build` type-checks and
  bundles it.
- None of this binds the apps. Their renderers are one-way doors taken at `/graduate`.
