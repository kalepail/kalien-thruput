//! Rust side of the TS/Rust parity check (see `parity.ts`).
//!
//! `parity gen <out-dir> <count> <seed> [fixture-dir...]` writes a deterministic corpus of tapes:
//! random and patterned inputs, mutated fixture tapes, tampered claims, and invalid containers.
//!
//! `parity eval <dir>` prints one JSON line per `.tape` file with the parse result, replayed
//! frames and score, a per-frame hash of the full sim state, checkpoint hashes, and the strict `verify_tape`
//! verdict. `parity.ts` computes the same fields with the TS sim and compares them.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use asteroids_verifier_core::constants::MAX_FRAMES_DEFAULT;
use asteroids_verifier_core::rng::SeededRng;
use asteroids_verifier_core::sim::{replay, AsteroidSizeSnapshot, LiveGame, WorldSnapshot};
use asteroids_verifier_core::tape::{crc32, parse_tape, parse_tape_ref, serialize_tape};
use asteroids_verifier_core::{verify_tape, VerifyError};

const CHECKPOINT_STRIDE: u32 = 500;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("gen") if args.len() >= 5 => {
            let out = PathBuf::from(&args[2]);
            let count: u32 = args[3].parse().expect("count");
            let seed: u32 = parse_u32(&args[4]);
            let fixtures: Vec<PathBuf> = args[5..].iter().map(PathBuf::from).collect();
            generate(&out, count, seed, &fixtures);
        }
        Some("eval") if args.len() == 3 => evaluate(Path::new(&args[2])),
        Some("explain") if args.len() == 3 => explain(Path::new(&args[2])),
        Some("gas-proxy") if args.len() == 3 => gas_proxy(Path::new(&args[2])),
        Some("gas-stats") if args.len() == 3 => gas_stats(Path::new(&args[2])),
        Some("gas-search") if args.len() >= 5 => {
            let out = PathBuf::from(&args[2]);
            let iters: u32 = args[3].parse().expect("iters");
            let seed = parse_u32(&args[4]);
            let starts: Vec<PathBuf> = args[5..].iter().map(PathBuf::from).collect();
            gas_search(&out, iters, seed, &starts);
        }
        _ => {
            eprintln!("usage: parity gen <out-dir> <count> <seed> [fixture-dir...]");
            eprintln!("       parity eval <dir>");
            eprintln!("       parity explain <tape>");
            eprintln!("       parity gas-proxy <dir>");
            eprintln!("       parity gas-search <out-dir> <iters> <seed> [start-tape...]");
            std::process::exit(2);
        }
    }
}

fn parse_u32(text: &str) -> u32 {
    match text.strip_prefix("0x") {
        Some(hex) => u32::from_str_radix(hex, 16).expect("hex u32"),
        None => text.parse().expect("u32"),
    }
}

// ---------------------------------------------------------------------------------------------
// Corpus generation
// ---------------------------------------------------------------------------------------------

struct Corpus {
    out: PathBuf,
    written: u32,
}

impl Corpus {
    fn write(&mut self, class: &str, bytes: &[u8]) {
        let name = format!("{class}-{:05}.tape", self.written);
        std::fs::write(self.out.join(name), bytes).expect("write tape");
        self.written += 1;
    }

    /// Writes a well-formed tape whose claim is the Rust (loose) replay score.
    fn write_valid(&mut self, class: &str, seed: u32, inputs: &[u8]) -> u32 {
        let score = replay(seed, inputs).final_score;
        self.write(class, &serialize_tape(seed, inputs, score));
        score
    }
}

fn length(rng: &mut SeededRng) -> usize {
    // A quarter of the tapes use the full 36,000 frames.
    if rng.next().is_multiple_of(4) {
        MAX_FRAMES_DEFAULT as usize
    } else {
        1 + (rng.next() % MAX_FRAMES_DEFAULT) as usize
    }
}

fn uniform_inputs(rng: &mut SeededRng, frames: usize) -> Vec<u8> {
    (0..frames).map(|_| (rng.next() & 0x0F) as u8).collect()
}

/// Held inputs with random run lengths and per-bit weights (closer to human play).
fn run_inputs(rng: &mut SeededRng, frames: usize) -> Vec<u8> {
    let weights = [
        rng.next() % 100,
        rng.next() % 100,
        rng.next() % 100,
        rng.next() % 100,
    ];
    let mut inputs = Vec::with_capacity(frames);
    while inputs.len() < frames {
        let mut byte = 0u8;
        for (bit, weight) in weights.iter().enumerate() {
            if rng.next() % 100 < *weight {
                byte |= 1 << bit;
            }
        }
        let run = 1 + (rng.next() % 120) as usize;
        for _ in 0..run.min(frames - inputs.len()) {
            inputs.push(byte);
        }
    }
    inputs
}

/// Deterministic edge patterns: fire toggling every frame (latch), fire held, both turn keys,
/// thrust held at max speed, idle, and every input value cycled.
fn pattern_inputs(pattern: u32, frames: usize) -> Vec<u8> {
    (0..frames)
        .map(|i| match pattern % 8 {
            0 => {
                if i % 2 == 0 {
                    0x08
                } else {
                    0x00
                }
            }
            1 => 0x08,
            2 => 0x03 | 0x08,
            3 => 0x04 | if i % 11 == 0 { 0x08 } else { 0 },
            4 => 0x00,
            5 => (i % 16) as u8,
            6 => 0x05 | if i % 10 == 0 { 0x08 } else { 0 },
            _ => {
                if (i / 9) % 2 == 0 {
                    0x0E
                } else {
                    0x0D
                }
            }
        })
        .collect()
}

fn load_fixture_inputs(dirs: &[PathBuf]) -> Vec<(u32, Vec<u8>)> {
    let mut tapes = Vec::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        let mut paths: Vec<PathBuf> = entries.map(|e| e.unwrap().path()).collect();
        paths.sort();
        for path in paths {
            if path.extension().is_none_or(|ext| ext != "tape") {
                continue;
            }
            let bytes = std::fs::read(&path).unwrap();
            if let Ok(tape) = parse_tape(&bytes, MAX_FRAMES_DEFAULT) {
                tapes.push((tape.header.seed, tape.inputs));
            }
        }
    }
    tapes
}

fn generate(out: &Path, count: u32, seed: u32, fixture_dirs: &[PathBuf]) {
    std::fs::create_dir_all(out).expect("create out dir");
    let mut corpus = Corpus {
        out: out.to_path_buf(),
        written: 0,
    };
    let mut rng = SeededRng::new(seed);
    let fixtures = load_fixture_inputs(fixture_dirs);

    // 1. Random and patterned play. Split `count` across the classes.
    for i in 0..count {
        let game_seed = rng.next();
        let frames = length(&mut rng);
        match i % 3 {
            0 => {
                let inputs = uniform_inputs(&mut rng, frames);
                corpus.write_valid("uniform", game_seed, &inputs);
            }
            1 => {
                let inputs = run_inputs(&mut rng, frames);
                corpus.write_valid("runs", game_seed, &inputs);
            }
            _ => {
                let inputs = pattern_inputs(i / 3, frames);
                corpus.write_valid("pattern", game_seed, &inputs);
            }
        }
    }

    // 2. Mutated fixtures: flip a few nibbles somewhere in a long, skilled run.
    for i in 0..count {
        if fixtures.is_empty() {
            break;
        }
        let (fixture_seed, base) = &fixtures[(rng.next() as usize) % fixtures.len()];
        let mut inputs = base.clone();
        let flips = 1 + rng.next() % 8;
        for _ in 0..flips {
            let at = (rng.next() as usize) % inputs.len();
            inputs[at] ^= (1 + rng.next() % 15) as u8;
        }
        if rng.next().is_multiple_of(3) {
            // Truncate or keep the prefix only.
            let keep = 1 + (rng.next() as usize) % inputs.len();
            inputs.truncate(keep);
        }
        if i % 2 == 0 {
            corpus.write_valid("mutant", *fixture_seed, &inputs);
        } else {
            // Keep the fixture's own claim: stale for the mutated run.
            let stale = replay(*fixture_seed, base).final_score;
            corpus.write(
                "mutant-stale",
                &serialize_tape(*fixture_seed, &inputs, stale),
            );
        }
    }

    // 3. Tampered claims on valid runs.
    for _ in 0..(count / 4).max(8) {
        let game_seed = rng.next();
        let frames = length(&mut rng);
        let inputs = run_inputs(&mut rng, frames);
        let score = replay(game_seed, &inputs).final_score;
        let claim = match rng.next() % 5 {
            0 => 0,
            1 => score.wrapping_add(1),
            2 => score.wrapping_sub(10),
            3 => score.wrapping_add(990),
            _ => u32::MAX,
        };
        if claim != score {
            corpus.write("claim", &serialize_tape(game_seed, &inputs, claim));
        }
    }

    // 4. Invalid containers.
    let base_inputs = run_inputs(&mut rng, 501);
    let base = serialize_tape(
        0xC0FF_EE11,
        &base_inputs,
        replay(0xC0FF_EE11, &base_inputs).final_score,
    );
    let mut variants: Vec<Vec<u8>> = Vec::new();
    variants.push(Vec::new());
    variants.push(base[..23].to_vec());
    for (offset, value) in [(0usize, 0x51u8), (4, 3), (4, 5), (5, 3), (6, 1), (7, 0x80)] {
        let mut v = base.clone();
        v[offset] = value;
        variants.push(v);
    }
    // Frame count 0, 36,001, and one more/less than the body holds (CRC fixed up each time).
    for frames in [0u32, MAX_FRAMES_DEFAULT + 1, 500, 502, 503, u32::MAX] {
        let mut v = base.clone();
        v[12..16].copy_from_slice(&frames.to_le_bytes());
        let body_end = v.len() - 8;
        let crc = crc32(&v[..body_end]);
        v[body_end + 4..].copy_from_slice(&crc.to_le_bytes());
        variants.push(v);
    }
    let mut trailing = base.clone();
    trailing.push(0);
    variants.push(trailing);
    let mut short = base.clone();
    short.pop();
    variants.push(short);
    for flip in [16usize, 100, base.len() - 1, base.len() - 5] {
        let mut v = base.clone();
        v[flip] ^= 0x10;
        variants.push(v);
    }
    // Odd frame count with a non-zero padding nibble (CRC fixed up): both parsers ignore it.
    let mut padded = base.clone();
    let last_body = padded.len() - 9;
    padded[last_body] |= 0xF0;
    let body_end = padded.len() - 8;
    let crc = crc32(&padded[..body_end]);
    padded[body_end + 4..].copy_from_slice(&crc.to_le_bytes());
    variants.push(padded);
    // A full-length max tape plus one byte.
    let max_inputs = uniform_inputs(&mut rng, MAX_FRAMES_DEFAULT as usize);
    let mut oversized = serialize_tape(7, &max_inputs, replay(7, &max_inputs).final_score);
    oversized.push(0);
    variants.push(oversized);
    for v in variants {
        corpus.write("invalid", &v);
    }

    eprintln!("wrote {} tapes to {}", corpus.written, out.display());
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

/// FNV-1a (32-bit) over little-endian u32 words. `parity.ts` uses the same function.
struct Fnv32(u32);

impl Fnv32 {
    fn word(&mut self, value: u32) {
        for byte in value.to_le_bytes() {
            self.0 ^= byte as u32;
            self.0 = self.0.wrapping_mul(16_777_619);
        }
    }
}

/// Ship and every live entity, in storage order. `parity.ts` hashes the same fields.
fn hash_entities(hash: &mut Fnv32, s: &WorldSnapshot) {
    let ship = &s.ship;
    for v in [ship.x, ship.y, ship.vx, ship.vy, ship.angle] {
        hash.word(v as u32);
    }
    hash.word(ship.can_control as u32);
    hash.word(ship.fire_cooldown as u32);
    hash.word(ship.respawn_timer as u32);
    hash.word(ship.invulnerable_timer as u32);
    hash.word(s.asteroids.len() as u32);
    for a in &s.asteroids {
        let size = match a.size {
            AsteroidSizeSnapshot::Large => 0,
            AsteroidSizeSnapshot::Medium => 1,
            AsteroidSizeSnapshot::Small => 2,
        };
        for v in [a.x, a.y, a.vx, a.vy, a.angle, size, a.spin] {
            hash.word(v as u32);
        }
    }
    for bullets in [&s.bullets, &s.saucer_bullets] {
        hash.word(bullets.len() as u32);
        for b in bullets {
            for v in [b.x, b.y, b.vx, b.vy, b.life] {
                hash.word(v as u32);
            }
        }
    }
    hash.word(s.saucers.len() as u32);
    for sc in &s.saucers {
        for v in [
            sc.x,
            sc.y,
            sc.vx,
            sc.vy,
            sc.small as i32,
            sc.fire_cooldown,
            sc.drift_timer,
        ] {
            hash.word(v as u32);
        }
    }
}

fn variant_name(err: &VerifyError) -> String {
    match err {
        VerifyError::RuleViolation { frame, rule } => format!("RuleViolation:{rule}@{frame}"),
        other => {
            let debug = format!("{other:?}");
            debug
                .split([' ', '{', '('])
                .next()
                .unwrap_or_default()
                .to_string()
        }
    }
}

fn evaluate(dir: &Path) {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(dir)
        .expect("read dir")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "tape"))
        .collect();
    paths.sort();

    for path in paths {
        let file = path.file_name().unwrap().to_string_lossy().to_string();
        let bytes = std::fs::read(&path).unwrap();
        let mut line = String::new();
        match parse_tape_ref(&bytes, MAX_FRAMES_DEFAULT) {
            Err(err) => {
                write!(
                    line,
                    r#"{{"file":"{file}","parse":"{}"}}"#,
                    variant_name(&err)
                )
                .unwrap();
            }
            Ok(tape) => {
                let mut game = LiveGame::new(tape.seed);
                let mut hash = Fnv32(0x811C_9DC5);
                let mut checkpoints = Vec::new();
                for (index, input) in tape.inputs().enumerate() {
                    game.step(input);
                    let s = game.snapshot();
                    hash.word(s.frame_count);
                    hash.word(s.score);
                    hash.word(s.lives as u32);
                    hash.word(s.wave as u32);
                    hash.word(s.rng_state);
                    hash.word(s.is_game_over as u32);
                    hash_entities(&mut hash, &s);
                    let frame = index as u32 + 1;
                    if frame.is_multiple_of(CHECKPOINT_STRIDE) {
                        checkpoints.push(format!("\"{:08x}\"", hash.0));
                    }
                }
                let result = game.result();
                let verdict = match verify_tape(&bytes, MAX_FRAMES_DEFAULT) {
                    Ok(_) => "ok".to_string(),
                    Err(err) => variant_name(&err),
                };
                write!(
                    line,
                    r#"{{"file":"{file}","parse":"ok","seed":{},"frames":{},"claimed":{},"score":{},"hash":"{:08x}","ck":[{}],"verify":"{verdict}"}}"#,
                    tape.seed,
                    result.frame_count,
                    tape.final_score,
                    result.final_score,
                    hash.0,
                    checkpoints.join(",")
                )
                .unwrap();
            }
        }
        println!("{line}");
    }
}

/// Prints the frames around the first strict-rule failure of one tape.
fn explain(path: &Path) {
    let bytes = std::fs::read(path).expect("read tape");
    let tape = parse_tape_ref(&bytes, MAX_FRAMES_DEFAULT).expect("tape parses");
    let err = verify_tape(&bytes, MAX_FRAMES_DEFAULT);
    println!("verify: {err:?}");
    let Err(VerifyError::RuleViolation { frame, .. }) = err else {
        return;
    };
    let mut game = LiveGame::new(tape.seed);
    for (index, input) in tape.inputs().enumerate() {
        let n = index as u32 + 1;
        if n + 3 >= frame && n <= frame + 1 {
            let before = game.snapshot();
            game.step(input);
            let s = game.snapshot();
            println!(
                "frame {n} input {input:04b} mode_over={} lives {}->{} score {}->{} wave {} | ship ({},{}) v({},{}) -> ({},{}) v({},{}) ctl {}->{} respawn {}->{} inv {} | asteroids {} bullets {} saucers {} sbullets {}",
                s.is_game_over, before.lives, s.lives, before.score, s.score, s.wave,
                before.ship.x, before.ship.y, before.ship.vx, before.ship.vy,
                s.ship.x, s.ship.y, s.ship.vx, s.ship.vy,
                before.ship.can_control, s.ship.can_control,
                before.ship.respawn_timer, s.ship.respawn_timer, s.ship.invulnerable_timer,
                s.asteroids.len(), s.bullets.len(), s.saucers.len(), s.saucer_bullets.len()
            );
        } else {
            game.step(input);
        }
        if n > frame + 1 {
            break;
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Worst-case gas search
// ---------------------------------------------------------------------------------------------

/// Host-side estimate of one frame's replay work: entity updates, the collision pairs that
/// `handle_collisions` can test, and the spawn-point grid search (117 points × entities) that
/// runs when the ship respawns or a wave starts. Only used to rank tapes; RV32 gas is measured
/// with `gas-probe` (`rv32_gas_sweep`).
fn frame_cost(prev: &WorldSnapshot, s: &WorldSnapshot) -> u64 {
    let a = s.asteroids.len() as u64;
    let b = s.bullets.len() as u64;
    let sb = s.saucer_bullets.len() as u64;
    let sc = s.saucers.len() as u64;
    let entities = a + b + sb + sc;
    let pairs = b * a + sb * a + b * sc + sc * a + a + sb + sc;
    let mut cost = 300 + 40 * entities + 25 * pairs;
    let respawned = !prev.ship.can_control && s.ship.can_control;
    if respawned || s.wave != prev.wave {
        cost += 117 * (entities + 1) * 30;
    }
    cost
}

struct Scored {
    total: u64,
    /// `(game, cumulative cost)` at the start of every `CHECKPOINT_FRAMES` block.
    checkpoints: Vec<(LiveGame, u64)>,
}

const SEARCH_FRAMES: usize = MAX_FRAMES_DEFAULT as usize;
const CHECKPOINT_FRAMES: usize = 1_000;

/// Scores `inputs`, reusing `base` checkpoints for the unchanged prefix before `from`.
fn score(seed: u32, inputs: &[u8], base: Option<(&Scored, usize)>) -> Scored {
    let (mut game, mut total, start_block, mut checkpoints) = match base {
        Some((scored, from)) => {
            let block = from / CHECKPOINT_FRAMES;
            let (game, total) = scored.checkpoints[block].clone();
            (game, total, block, scored.checkpoints[..block].to_vec())
        }
        None => (LiveGame::new(seed), 0, 0, Vec::new()),
    };
    let mut prev = game.snapshot();
    for (index, input) in inputs.iter().enumerate().skip(start_block * CHECKPOINT_FRAMES) {
        if index % CHECKPOINT_FRAMES == 0 {
            checkpoints.push((game.clone(), total));
        }
        game.step(*input);
        let next = game.snapshot();
        total += frame_cost(&prev, &next);
        prev = next;
    }
    Scored { total, checkpoints }
}

fn gas_proxy(dir: &Path) {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(dir)
        .expect("read dir")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "tape"))
        .collect();
    paths.sort();
    println!("file,frames,proxy,proxy_per_frame");
    for path in paths {
        let bytes = std::fs::read(&path).unwrap();
        let Ok(tape) = parse_tape_ref(&bytes, MAX_FRAMES_DEFAULT) else {
            continue;
        };
        let inputs: Vec<u8> = tape.inputs().collect();
        let scored = score(tape.seed, &inputs, None);
        println!(
            "{},{},{},{:.1}",
            path.file_name().unwrap().to_string_lossy(),
            tape.frame_count,
            scored.total,
            scored.total as f64 / tape.frame_count as f64
        );
    }
}

fn mutate(rng: &mut SeededRng, inputs: &mut [u8]) -> usize {
    let len_cap = 1usize << (rng.next() % 12); // 1..2048 frames
    let len = 1 + (rng.next() as usize) % len_cap;
    let start = (rng.next() as usize) % inputs.len();
    let end = (start + len).min(inputs.len());
    match rng.next() % 5 {
        0 => {
            let byte = (rng.next() & 0x0F) as u8;
            inputs[start..end].fill(byte);
        }
        1 => {
            for input in &mut inputs[start..end] {
                *input = (rng.next() & 0x0F) as u8;
            }
        }
        2 => {
            // Fire on alternate frames (fastest legal fire rate) with a random movement mask.
            let movement = (rng.next() & 0x07) as u8;
            for (i, input) in inputs[start..end].iter_mut().enumerate() {
                *input = movement | if i % 2 == 0 { 0x08 } else { 0 };
            }
        }
        3 => {
            // Clear fire: let entities accumulate.
            for input in &mut inputs[start..end] {
                *input &= 0x07;
            }
        }
        _ => {
            let flip = (1 + rng.next() % 15) as u8;
            inputs[start] ^= flip;
        }
    }
    start
}

fn gas_search(out: &Path, iters: u32, seed: u32, starts: &[PathBuf]) {
    std::fs::create_dir_all(out).expect("create out dir");
    let mut rng = SeededRng::new(seed);
    let mut jobs: Vec<(String, u32, Vec<u8>)> = Vec::new();
    for path in starts {
        let bytes = std::fs::read(path).expect("read start tape");
        let tape = parse_tape(&bytes, MAX_FRAMES_DEFAULT).expect("start tape parses");
        let mut inputs = tape.inputs;
        while inputs.len() < SEARCH_FRAMES {
            inputs.push((rng.next() & 0x0F) as u8);
        }
        let name = path.file_stem().unwrap().to_string_lossy().to_string();
        jobs.push((name, tape.header.seed, inputs));
    }
    if jobs.is_empty() {
        let inputs = (0..SEARCH_FRAMES).map(|_| (rng.next() & 0x0F) as u8).collect();
        jobs.push((format!("random-{seed:08x}"), rng.next(), inputs));
    }

    for (name, game_seed, mut inputs) in jobs {
        let mut best = score(game_seed, &inputs, None);
        let first = best.total;
        for _ in 0..iters {
            let mut candidate = inputs.clone();
            let from = mutate(&mut rng, &mut candidate);
            let scored = score(game_seed, &candidate, Some((&best, from)));
            if scored.total >= best.total {
                inputs = candidate;
                best = scored;
            }
        }
        let result = replay(game_seed, &inputs);
        let bytes = serialize_tape(game_seed, &inputs, result.final_score);
        let file = out.join(format!("gas-{name}.tape"));
        std::fs::write(&file, &bytes).unwrap();
        eprintln!(
            "{}: proxy/frame {:.0} -> {:.0}, score {}, strict {:?}",
            file.display(),
            first as f64 / SEARCH_FRAMES as f64,
            best.total as f64 / SEARCH_FRAMES as f64,
            result.final_score,
            verify_tape(&bytes, MAX_FRAMES_DEFAULT).map(|v| v.final_score)
        );
    }
}

/// Prints what drives the cost of one tape: spawn searches, deaths, waves, entity averages.
fn gas_stats(path: &Path) {
    let bytes = std::fs::read(path).expect("read tape");
    let tape = parse_tape_ref(&bytes, MAX_FRAMES_DEFAULT).expect("tape parses");
    let mut game = LiveGame::new(tape.seed);
    let mut prev = game.snapshot();
    let (mut spawns, mut deaths, mut sum_a, mut sum_b, mut sum_s, mut sum_sb) = (0u64, 0u64, 0u64, 0u64, 0u64, 0u64);
    let mut max_a = 0usize;
    let mut game_over_at = None;
    let mut costs: Vec<u64> = Vec::with_capacity(tape.frame_count as usize);
    let mut block = [0u64; 4];
    for (i, input) in tape.inputs().enumerate() {
        game.step(input);
        let s = game.snapshot();
        if (!prev.ship.can_control && s.ship.can_control) || s.wave != prev.wave {
            spawns += 1;
        }
        if prev.ship.can_control && !s.ship.can_control {
            deaths += 1;
        }
        if s.is_game_over && game_over_at.is_none() {
            game_over_at = Some(i + 1);
        }
        sum_a += s.asteroids.len() as u64;
        sum_b += s.bullets.len() as u64;
        sum_s += s.saucers.len() as u64;
        sum_sb += s.saucer_bullets.len() as u64;
        max_a = max_a.max(s.asteroids.len());
        costs.push(frame_cost(&prev, &s));
        block[0] += s.asteroids.len() as u64;
        block[1] += s.saucers.len() as u64;
        block[2] += s.saucer_bullets.len() as u64;
        block[3] += s.bullets.len() as u64;
        if (i + 1) % 3_000 == 0 {
            println!(
                "frames {:>5}-{:>5}: wave {} lives {} over {} avg asteroids {:.1} saucers {:.2} saucer_bullets {:.2} bullets {:.2}",
                i + 1 - 2_999, i + 1, s.wave, s.lives, s.is_game_over,
                block[0] as f64 / 3_000.0, block[1] as f64 / 3_000.0, block[2] as f64 / 3_000.0, block[3] as f64 / 3_000.0
            );
            block = [0; 4];
        }
        prev = s;
    }
    let n = tape.frame_count as f64;
    costs.sort_unstable();
    println!(
        "frames {} score {} wave {} lives {} game_over_at {:?} spawns {} deaths {}",
        tape.frame_count, prev.score, prev.wave, prev.lives, game_over_at, spawns, deaths
    );
    println!(
        "avg asteroids {:.1} (max {max_a}) bullets {:.2} saucers {:.2} saucer_bullets {:.2}",
        sum_a as f64 / n, sum_b as f64 / n, sum_s as f64 / n, sum_sb as f64 / n
    );
    println!(
        "proxy per frame: median {} p99 {} max {}",
        costs[costs.len() / 2],
        costs[costs.len() * 99 / 100],
        costs[costs.len() - 1]
    );
}
