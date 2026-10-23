# Asteroids Game Spec

The Rust core (`asteroids-core/src/sim/`) is the reference implementation. The TypeScript twin
(`src/game/AsteroidsGame.ts`) must match it on every frame
(`bun run asteroids-core/parity/parity.ts`). When this page and the code disagree, the Rust code
wins; fix this page.

## Deterministic Gameplay Contract
Game state transitions must be deterministic given:
- initial seed
- per-frame input bytes
- canonical update order

## Input Model
- 4 action bits per frame: `left`, `right`, `thrust`, `fire` (bit 0 to bit 3).
- The tape packs two frames per byte (see `02-VERIFICATION-SPEC.md`).

## Core Mechanics
### Ship
- Rotation uses 8-bit BAM.
- Thrust and drag operate in fixed-point integer space.
- Speed is clamped to configured max.
- On death, the ship respawns after a fixed delay (`SHIP_RESPAWN_FRAMES = 75`) with spawn invulnerability.
- On wave start, ship spawn is immediate (`queueShipRespawn(0)`).

### Player bullets
- Bullet cap is enforced.
- Fire is edge-triggered: a shot needs a new press (fire latch) and an expired cooldown
  (`SHIP_BULLET_COOLDOWN_FRAMES = 10`). See `03-INTEGER-MATH-SPEC.md`.
- Bullet lifetime is frame-based.
- Ship bullet lifetime is `72` frames.

### Asteroids
- Wave-based spawning with cap.
- Size transitions: large -> medium -> small -> removed.
- Split behavior respects live-entity caps.

### Saucers
- Spawn cadence and count scale with progression (max concurrent saucers by wave: `1` for waves `<4`, `2` for waves `4..6`, `3` for waves `>=7`).
- Anti-lurk behavior increases pressure when player stalls.
- Small saucers aim with bounded error; large saucers are less accurate.
- Saucers only enter from left/right edges and are culled as soon as they leave X bounds.
- Saucer fire cadence uses deterministic pressure-based cooldown ranges (sampled from game RNG), not a fixed reload constant.
- Saucer bullet hard cap is `2`, with lifetime `72` frames.

### Scoring and progression
- Score increments only from valid destruction events.
- Extra life threshold uses fixed score step.
- Wave progression triggers only when required entities are cleared.

## Difficulty and Session-Length Policy
A run lasts at most 36,000 frames (10 minutes at 60 FPS). Most high-skill runs end sooner,
because difficulty rises with each wave. The on-chain replay cost grows with the frame count
(about 2,065 gas per frame).

### Difficulty controls
- Asteroid wave count scales up to a cap of 16.
- Saucer concurrency scales by wave (`1`, then `2`, then `3` in late waves).
- Saucer spawn cadence accelerates with wave and anti-lurk pressure.
- Saucer firing cadence tightens with pressure via deterministic cooldown ranges.
- Small-saucer aim tightens with wave progression.
- Asteroid speed increases by wave with an upper cap.
- Anti-lurk threshold is fixed at 6 seconds (`360` frames at 60 FPS).

### Baseline progression constants
- Starting lives: `3`
- Extra life step: `10,000`
- Asteroid score bands: `20 / 50 / 100`
- Saucer score bands: `200 / 990`

## Deliberate Scope Decisions
- Hyperspace is omitted in this version to keep controls, verification surface,
  and deterministic state space tighter.

## Scope Exclusions (Non-Consensus)
- Visual effects
- Audio behavior
- Rendering interpolation and cosmetic randomness
