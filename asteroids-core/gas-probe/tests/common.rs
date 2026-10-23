//! Shared fixtures for the native and RV32 gas-probe tests.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

pub struct Fixture {
    pub name: &'static str,
    pub path: &'static str,
    pub frames: u32,
    pub score: u32,
}

/// Paths are relative to the repo root.
pub const FIXTURES: [Fixture; 5] = [
    Fixture {
        name: "test-short",
        path: "test-fixtures/test-short.tape",
        frames: 700,
        score: 1_480,
    },
    Fixture {
        name: "test-medium",
        path: "test-fixtures/test-medium.tape",
        frames: 5_000,
        score: 11_190,
    },
    Fixture {
        name: "test-real-game",
        path: "test-fixtures/test-real-game.tape",
        frames: 6_643,
        score: 14_870,
    },
    Fixture {
        name: "test-long",
        path: "test-fixtures/test-long.tape",
        frames: 36_000,
        score: 92_820,
    },
    Fixture {
        name: "kalien-911140",
        path: "autopilot/fixtures/public/kalien-911140-seed1598125870.tape",
        frames: 36_000,
        score: 911_140,
    },
];

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .find(|dir| dir.join("test-fixtures").is_dir())
        .expect("repo root with test-fixtures/")
        .to_path_buf()
}

pub fn load(fixture: &Fixture) -> Vec<u8> {
    let path = repo_root().join(fixture.path);
    std::fs::read(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()))
}
