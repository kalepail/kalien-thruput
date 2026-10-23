import { AsteroidsGame } from "../src/game/AsteroidsGame";
import { TapeInputSource } from "../src/game/input-source";
import { deserializeTape } from "../src/game/tape";
import { MAX_TAPE_FRAMES } from "./constants";

export interface ReplayResult {
  seed: number;
  frameCount: number;
  claimedScore: number;
  replayedScore: number;
}

/**
 * Replays a tape with the TypeScript simulation. The contract replays the
 * same tape with the Rust core; this pre-check rejects bad runs before the
 * relay spends gas on them.
 */
export function replayTape(bytes: Uint8Array): ReplayResult {
  const tape = deserializeTape(bytes, MAX_TAPE_FRAMES);
  const game = new AsteroidsGame({ headless: true, seed: tape.header.seed });
  game.startNewGame(tape.header.seed);
  game.setInputSource(new TapeInputSource(tape.inputs));
  for (let frame = 0; frame < tape.header.frameCount; frame += 1) {
    game.stepSimulation();
  }
  return {
    seed: tape.header.seed >>> 0,
    frameCount: tape.header.frameCount,
    claimedScore: tape.footer.finalScore >>> 0,
    replayedScore: game.getScore() >>> 0,
  };
}
