import type { WorkerEnv } from "../env";
import { bytesToHex, hexToBytes } from "../hex";
import { safeErrorMessage } from "../utils";
import type { IndexedScoreSubmitted, ScoreContract, ScoreSubmitted } from "../chain/score-contract";
import {
  countScoreEvents,
  getIndexerState,
  indexerStateStatement,
  scoreEventStatement,
  type IndexerState,
  type ScoreEventRow,
} from "./store";

export interface IndexerChain {
  blockTimeMs(height: bigint): Promise<number>;
}

export interface SyncResult {
  pages: number;
  events: number;
  inserted: number;
  fromHeight: string;
  lastHeight: string;
  exhausted: boolean;
  latestBlock: string | null;
  warning: string | null;
}

export function scoreEventRow(
  event: ScoreSubmitted,
  meta: {
    txHash: string;
    blockHeight: bigint;
    closedAtMs: number;
    source: ScoreEventRow["source"];
  },
): ScoreEventRow {
  return {
    tapeHash: event.tapeHash.replace(/^0x/iu, "").toLowerCase(),
    playerAddress: event.player.toLowerCase(),
    seedId: event.seedId,
    seed: event.seed >>> 0,
    frameCount: event.frameCount,
    finalScore: event.finalScore,
    previousBest: event.previousBest,
    newBest: event.newBest,
    mintedDelta: event.mintedDelta.toString(),
    txHash: meta.txHash.toLowerCase(),
    blockHeight: meta.blockHeight.toString(),
    closedAt: new Date(meta.closedAtMs).toISOString(),
    source: meta.source,
  };
}

function freshState(contractAddress: string): IndexerState {
  return {
    contractAddress,
    fromHeight: "0",
    cursor: "",
    lastHeight: "0",
    latestBlock: null,
    oldestBlock: null,
    lastSyncedAt: null,
    totalEvents: 0,
    lastError: null,
  };
}

/**
 * Walks `ScoreSubmitted` events in ascending order and saves rows and
 * progress in one D1 batch per page. Rows dedupe by tape hash, so a restart
 * at the last stored height is safe.
 */
export async function syncScoreEvents(
  env: WorkerEnv,
  score: ScoreContract,
  chain: IndexerChain,
  options: { maxPages: number; pageLimit: number },
): Promise<SyncResult> {
  const saved = await getIndexerState(env);
  let state =
    saved && saved.contractAddress.toLowerCase() === score.address.toLowerCase()
      ? saved
      : freshState(score.address);
  let warning: string | null = null;
  let pages = 0;
  let events = 0;
  let inserted = 0;
  let exhausted = false;

  try {
    while (pages < options.maxPages) {
      // eslint-disable-next-line no-await-in-loop -- pages depend on the previous cursor
      const page = await score.scoreEvents({
        fromHeight: BigInt(state.fromHeight),
        cursor: state.cursor ? hexToBytes(state.cursor) : new Uint8Array(),
        limit: options.pageLimit,
      });
      pages += 1;
      if (BigInt(state.lastHeight) > 0n && page.oldestBlock > BigInt(state.lastHeight)) {
        warning = `history gap: indexer keeps blocks from ${page.oldestBlock}, last stored row is at ${state.lastHeight}`;
      }
      // eslint-disable-next-line no-await-in-loop -- block times for this page
      const rows = await rowsForPage(page.events, chain);
      const last = page.events.at(-1);
      const cursor = bytesToHex(page.cursor);
      exhausted = cursor.length === 0;
      const lastHeight = last ? last.blockHeight.toString() : state.lastHeight;
      const next: IndexerState = {
        ...state,
        // An exhausted walk restarts inclusively at the last stored row.
        fromHeight: exhausted ? lastHeight : state.fromHeight,
        cursor,
        lastHeight,
        latestBlock: page.latestBlock.toString(),
        oldestBlock: page.oldestBlock.toString(),
        lastSyncedAt: new Date().toISOString(),
        lastError: warning,
      };
      // eslint-disable-next-line no-await-in-loop -- rows and progress in one batch
      const results = await env.LEADERBOARD_DB.batch([
        ...rows.map((row) => scoreEventStatement(env, row)),
        indexerStateStatement(env, next),
      ]);
      inserted += results.slice(0, rows.length).filter((r) => (r.meta?.changes ?? 0) > 0).length;
      events += rows.length;
      state = next;
      if (exhausted) {
        break;
      }
    }
  } catch (error) {
    const message = safeErrorMessage(error);
    await indexerStateStatement(env, { ...state, lastError: message }).run();
    throw error;
  }

  if (inserted > 0) {
    const total = await countScoreEvents(env);
    state = { ...state, totalEvents: total };
    await indexerStateStatement(env, state).run();
  }

  return {
    pages,
    events,
    inserted,
    fromHeight: state.fromHeight,
    lastHeight: state.lastHeight,
    exhausted,
    latestBlock: state.latestBlock,
    warning,
  };
}

async function rowsForPage(
  events: IndexedScoreSubmitted[],
  chain: IndexerChain,
): Promise<ScoreEventRow[]> {
  const times = new Map<bigint, number>();
  for (const height of new Set(events.map((event) => event.blockHeight))) {
    // eslint-disable-next-line no-await-in-loop -- few distinct blocks per page
    times.set(height, await chain.blockTimeMs(height));
  }
  return events.map((event) =>
    scoreEventRow(event, {
      txHash: event.txHash,
      blockHeight: event.blockHeight,
      closedAtMs: times.get(event.blockHeight) ?? Date.now(),
      source: "indexer",
    }),
  );
}
