-- Kalien on Thruput: leaderboard, profiles, seeds, and indexer progress.

-- One row per ScoreSubmitted event. A tape hash can be claimed once per
-- score contract, so (contract, tape_hash) identifies the event for both the
-- relay and the indexer. A redeployed contract starts an empty leaderboard.
CREATE TABLE score_events (
  contract TEXT NOT NULL,
  tape_hash TEXT NOT NULL,
  player_address TEXT NOT NULL,
  seed_id INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  frame_count INTEGER NOT NULL,
  final_score INTEGER NOT NULL,
  previous_best INTEGER NOT NULL,
  new_best INTEGER NOT NULL,
  minted_delta INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  block_height INTEGER NOT NULL,
  closed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (contract, tape_hash)
);

CREATE INDEX idx_score_events_closed_at ON score_events(contract, closed_at DESC);
CREATE INDEX idx_score_events_player_closed_at
  ON score_events(contract, player_address, closed_at DESC);
CREATE INDEX idx_score_events_rank
  ON score_events(contract, new_best DESC, closed_at ASC, tape_hash ASC);
CREATE INDEX idx_score_events_tx ON score_events(tx_hash);

CREATE TABLE player_profiles (
  player_address TEXT PRIMARY KEY,
  player_pubkey TEXT NOT NULL,
  username TEXT,
  link_url TEXT,
  -- Timestamp (ms) inside the last accepted signed update. Newer only.
  signed_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE seeds (
  contract TEXT NOT NULL,
  seed_id INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (contract, seed_id)
);

CREATE TABLE indexer_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  -- A new score contract (redeploy or devnet reset) restarts the walk.
  contract_address TEXT NOT NULL,
  -- Ascending walk anchored at from_height. cursor (hex) continues it; ""
  -- starts a new walk. last_height is the newest stored row's block; a new
  -- walk starts there (inclusive) and dedupes by tape hash.
  from_height TEXT NOT NULL,
  cursor TEXT NOT NULL,
  last_height TEXT NOT NULL,
  latest_block TEXT,
  oldest_block TEXT,
  last_synced_at TEXT,
  total_events INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
