//! Golden replay baseline.
//!
//! Records, for every known tape, the frame count, final score, strict-replay result, and a
//! chained FNV-1a hash over the full world snapshot after every frame (plus the chained hash
//! every 1,000 frames). Any behavior change in the simulation changes these values.
//!
//! Regenerate with `UPDATE_GOLDEN=1 cargo test --test golden` only when a rules change is
//! intended.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use asteroids_verifier_core::rng::SeededRng;
use asteroids_verifier_core::sim::{
    replay, replay_strict, AsteroidSizeSnapshot, BulletSnapshot, LiveGame, WorldSnapshot,
};
use asteroids_verifier_core::tape::{parse_tape, serialize_tape};

const GOLDEN_FILE: &str = "tests/golden/replay-golden.txt";
const HASH_STRIDE: u32 = 1_000;
const MAX_FRAMES: u32 = 36_000;

struct Fnv(u64);

impl Fnv {
    fn new() -> Self {
        Self(0xCBF2_9CE4_8422_2325)
    }

    fn u32(&mut self, value: u32) {
        for byte in value.to_le_bytes() {
            self.0 ^= byte as u64;
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01B3);
        }
    }

    fn i32(&mut self, value: i32) {
        self.u32(value as u32);
    }

    fn bool(&mut self, value: bool) {
        self.u32(value as u32);
    }
}

fn hash_bullet(h: &mut Fnv, b: &BulletSnapshot) {
    h.i32(b.x);
    h.i32(b.y);
    h.i32(b.vx);
    h.i32(b.vy);
    h.bool(b.alive);
    h.i32(b.radius);
    h.i32(b.life);
}

fn hash_world(h: &mut Fnv, w: &WorldSnapshot) {
    h.u32(w.frame_count);
    h.u32(w.score);
    h.i32(w.lives);
    h.i32(w.wave);
    h.bool(w.is_game_over);
    h.u32(w.rng_state);
    h.i32(w.saucer_spawn_timer);
    h.i32(w.time_since_last_kill);
    h.u32(w.next_extra_life_score);

    let s = &w.ship;
    h.i32(s.x);
    h.i32(s.y);
    h.i32(s.vx);
    h.i32(s.vy);
    h.i32(s.angle);
    h.i32(s.radius);
    h.bool(s.can_control);
    h.i32(s.fire_cooldown);
    h.i32(s.respawn_timer);
    h.i32(s.invulnerable_timer);

    h.u32(w.asteroids.len() as u32);
    for a in &w.asteroids {
        h.i32(a.x);
        h.i32(a.y);
        h.i32(a.vx);
        h.i32(a.vy);
        h.i32(a.angle);
        h.bool(a.alive);
        h.i32(a.radius);
        h.u32(match a.size {
            AsteroidSizeSnapshot::Large => 0,
            AsteroidSizeSnapshot::Medium => 1,
            AsteroidSizeSnapshot::Small => 2,
        });
        h.i32(a.spin);
    }

    h.u32(w.bullets.len() as u32);
    for b in &w.bullets {
        hash_bullet(h, b);
    }

    h.u32(w.saucers.len() as u32);
    for s in &w.saucers {
        h.i32(s.x);
        h.i32(s.y);
        h.i32(s.vx);
        h.i32(s.vy);
        h.bool(s.alive);
        h.i32(s.radius);
        h.bool(s.small);
        h.i32(s.fire_cooldown);
        h.i32(s.drift_timer);
    }

    h.u32(w.saucer_bullets.len() as u32);
    for b in &w.saucer_bullets {
        hash_bullet(h, b);
    }
}

fn golden_line(name: &str, seed: u32, claimed_score: u32, inputs: &[u8]) -> String {
    let mut game = LiveGame::new(seed);
    let mut hash = Fnv::new();
    hash_world(&mut hash, &game.snapshot());
    let mut checkpoints = Vec::new();

    for (index, input) in inputs.iter().enumerate() {
        game.step(*input);
        hash_world(&mut hash, &game.snapshot());
        let frame = (index + 1) as u32;
        if frame.is_multiple_of(HASH_STRIDE) {
            checkpoints.push(format!("{:016x}", hash.0));
        }
    }

    let live = game.result();
    let loose = replay(seed, inputs);
    assert_eq!(live, loose, "{name}: LiveGame and replay() disagree");

    let strict = match replay_strict(seed, inputs) {
        Ok(result) => {
            assert_eq!(result, loose, "{name}: replay_strict and replay() disagree");
            "ok".to_string()
        }
        Err(violation) => format!("{:?}@{}", violation.rule, violation.frame_count),
    };

    let mut line = String::new();
    write!(
        line,
        "{name} seed={seed:08x} frames={} claimed={claimed_score} score={} strict={strict} hash={:016x} ck={}",
        loose.frame_count,
        loose.final_score,
        hash.0,
        checkpoints.join(",")
    )
    .unwrap();
    line
}

fn repo_root() -> PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .ancestors()
        .find(|dir| dir.join("test-fixtures").is_dir())
        .expect("repo root with test-fixtures/")
        .to_path_buf()
}

fn tape_files() -> Vec<(String, PathBuf)> {
    let root = repo_root();
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let dirs = [
        ("test-fixtures", root.join("test-fixtures")),
        ("autopilot-public", root.join("autopilot/fixtures/public")),
        ("local", manifest.join("tests/fixtures/local")),
    ];

    let mut files = Vec::new();
    for (label, dir) in dirs {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)
            .unwrap_or_else(|err| panic!("read {}: {err}", dir.display()))
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "tape"))
            .collect();
        entries.sort();
        for path in entries {
            let name = format!(
                "{label}/{}",
                path.file_name().unwrap().to_string_lossy()
            );
            files.push((name, path));
        }
    }
    files
}

fn synthetic_inputs(input_seed: u32, frame_count: usize) -> Vec<u8> {
    let mut rng = SeededRng::new(input_seed);
    (0..frame_count).map(|_| (rng.next() & 0x0F) as u8).collect()
}

fn build_golden() -> String {
    let mut out = String::new();

    for (name, path) in tape_files() {
        let bytes = std::fs::read(&path).unwrap();
        let tape = match parse_tape(&bytes, MAX_FRAMES) {
            Ok(tape) => tape,
            Err(err) => {
                // Old-format tapes stay in the set so the parser's rejection is pinned too.
                writeln!(out, "{name} parse_error={err:?}").unwrap();
                continue;
            }
        };
        out.push_str(&golden_line(
            &name,
            tape.header.seed,
            tape.footer.final_score,
            &tape.inputs,
        ));
        out.push('\n');
    }

    // Synthetic fixtures used by the other integration tests, plus a full-length random tape.
    let synthetic: [(&str, u32, u32, usize); 6] = [
        ("synthetic/checkpoints-short", 0xDEAD_BEEF, 0xA0A0_0001, 700),
        ("synthetic/checkpoints-medium", 0xDEAD_BEEF, 0xA0A0_0002, 4_500),
        ("synthetic/fixtures-short", 0xDEAD_BEEF, 0xA0A0_0101, 500),
        ("synthetic/fixtures-medium", 0xDEAD_BEEF, 0xA0A0_0202, 3_980),
        ("synthetic/fixtures-downloads", 0x9432_C6CD, 0xA0A0_0303, 13_829),
        ("synthetic/random-36000", 0x1234_5678, 0xA0A0_0404, 36_000),
    ];
    for (name, seed, input_seed, frames) in synthetic {
        let inputs = synthetic_inputs(input_seed, frames);
        let result = replay(seed, &inputs);
        // Round-trip through the tape format so the packed reader is covered too.
        let bytes = serialize_tape(seed, &inputs, result.final_score);
        let tape = parse_tape(&bytes, MAX_FRAMES).unwrap();
        assert_eq!(tape.inputs, inputs, "{name}: tape round-trip");
        out.push_str(&golden_line(name, seed, result.final_score, &tape.inputs));
        out.push('\n');
    }

    out
}

#[test]
fn replay_matches_golden_baseline() {
    let actual = build_golden();
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(GOLDEN_FILE);

    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &actual).unwrap();
        return;
    }

    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
    let expected_lines: Vec<&str> = expected.lines().collect();
    let actual_lines: Vec<&str> = actual.lines().collect();
    for (exp, act) in expected_lines.iter().zip(actual_lines.iter()) {
        assert_eq!(act, exp, "golden mismatch");
    }
    assert_eq!(actual_lines.len(), expected_lines.len(), "golden line count");
}
