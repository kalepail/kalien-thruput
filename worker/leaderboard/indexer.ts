import type { WorkerEnv } from "../env";
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

/** Blocks below a walk's first head height where the next walk starts. */
const WATERMARK_MARGIN_BLOCKS = 20n;

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
    playerAddress: event.player,
    seedId: event.seedId,
    seed: event.seed >>> 0,
    frameCount: event.frameCount,
    finalScore: event.finalScore,
    previousBest: event.previousBest,
    newBest: event.newBest,
    mintedDelta: event.mintedDelta.toString(),
    txHash: meta.txHash,
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
  let state = saved && saved.contractAddress === score.address ? saved : freshState(score.address);
  let warning: string | null = null;
  let pages = 0;
  let events = 0;
  let inserted = 0;
  let exhausted = false;
  // Set when this sync starts a new walk: the head height its first page saw.
  let walkWatermark: bigint | null = state.cursor ? null : -1n;

  try {
    while (pages < options.maxPages) {
      // eslint-disable-next-line no-await-in-loop -- pages depend on the previous cursor
      const page = await score.scoreEvents({
        fromHeight: BigInt(state.fromHeight),
        cursor: state.cursor || null,
        limit: options.pageLimit,
      });
      pages += 1;
      if (walkWatermark === -1n) {
        walkWatermark = page.latestIndexedBlockHeight;
      }
      if (
        BigInt(state.lastHeight) > 0n &&
        page.oldestIndexedBlockHeight > BigInt(state.lastHeight)
      ) {
        warning = `history gap: indexer keeps blocks from ${page.oldestIndexedBlockHeight}, last stored row is at ${state.lastHeight}`;
      }
      // eslint-disable-next-line no-await-in-loop -- block times for this page
      const rows = await rowsForPage(page.events, chain);
      const last = page.events.at(-1);
      // Only a null cursor ends the walk; empty pages can continue.
      const cursor = page.nextCursor ?? "";
      exhausted = page.nextCursor === null;
      const lastHeight = last ? last.blockHeight.toString() : state.lastHeight;
      // An exhausted walk restarts inclusively at the last stored row, or, when
      // this whole walk ran in this sync, just below the head its first page
      // saw (no re-scan of quiet ranges; rows dedupe, so overlap is safe).
      let nextFrom = lastHeight;
      if (exhausted && walkWatermark !== null && walkWatermark > WATERMARK_MARGIN_BLOCKS) {
        const skip = walkWatermark - WATERMARK_MARGIN_BLOCKS;
        if (skip > BigInt(lastHeight)) nextFrom = skip.toString();
      }
      const next: IndexerState = {
        ...state,
        fromHeight: exhausted ? nextFrom : state.fromHeight,
        cursor,
        lastHeight,
        latestBlock: page.latestIndexedBlockHeight.toString(),
        oldestBlock: page.oldestIndexedBlockHeight.toString(),
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

  const total = await countScoreEvents(env);
  if (total !== state.totalEvents) {
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
  const times = new Map<bigint, number | null>();
  for (const height of new Set(events.map((event) => event.blockHeight))) {
    // eslint-disable-next-line no-await-in-loop -- few distinct blocks per page
    times.set(height, await chain.blockTimeMs(height).catch(() => null));
  }
  return events.map((event) =>
    scoreEventRow(event, {
      txHash: event.txHash,
      blockHeight: event.blockHeight,
      // The block's own time; the event's seconds if the block lookup failed.
      closedAtMs: times.get(event.blockHeight) ?? event.submittedAt * 1000,
      source: "indexer",
    }),
  );
}

/** Ops: restart the walk at `fromHeight` (inclusive) and clear a bad cursor. */
export async function resetIndexer(
  env: WorkerEnv,
  contractAddress: string,
  fromHeight: bigint,
): Promise<IndexerState> {
  const saved = await getIndexerState(env);
  const state: IndexerState = {
    ...(saved && saved.contractAddress === contractAddress ? saved : freshState(contractAddress)),
    fromHeight: fromHeight.toString(),
    cursor: "",
    lastHeight: fromHeight.toString(),
    lastError: null,
  };
  await indexerStateStatement(env, state).run();
  return state;
}
