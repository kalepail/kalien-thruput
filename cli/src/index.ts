#!/usr/bin/env bun

import { cpus } from "os";
import { readFileSync } from "fs";
import { resolve } from "path";
import { cleanupCommand, psCommand } from "./commands/processes";
import { replayCommand } from "./commands/replay";
import { runCommand } from "./commands/run";
import { statusCommand, submitCommand } from "./commands/submit";
import { keyCommand, resolveIdentity, whoamiCommand } from "./commands/identity";
import * as ansi from "./display/ansi";
import { DEFAULT_API_URL } from "./constants";
import { defaultKeyPath } from "./identity/keyfile";

const HELP = `
${ansi.brightCyan}KALIEN${ansi.reset} - Autonomous Asteroids Farming CLI (Thruput devnet)

${ansi.bold}USAGE${ansi.reset}
  kalien run [options]
  kalien submit <tape-file> [--seed-id <n>] [--no-wait] [--json]
  kalien status <run-id> [--wait]
  kalien whoami [--json]
  kalien key <path|export|import|new> [secret|-]
  kalien replay <tape-file>
  kalien ps
  kalien cleanup [options]

${ansi.bold}COMMANDS${ansi.reset}
  run       Start autonomous farming (play games + submit runs)
  submit    Sign and submit one tape file, then wait for the result
  status    Show the status of a submitted run
  whoami    Show the player address for the local key
  key       Show the key path, export or import the player secret key
  replay    ASCII replay of a .tape file in the terminal
  ps        List active kalien run processes
  cleanup   Terminate stale kalien run processes

${ansi.bold}COMMON OPTIONS${ansi.reset}
  --key <path>          Player key file (default: $KALIEN_KEY_FILE or ~/.config/kalien/key.json).
                        Made on first use with mode 0600.
  --api-url <url>       Kalien API base URL (default: $KALIEN_API_URL or
                        ${DEFAULT_API_URL})

${ansi.bold}RUN OPTIONS${ansi.reset}
  --threads <n|max|%>   Worker count: number, "max", or percentage (e.g. "25%"). Default: 50%

${ansi.bold}SUBMIT OPTIONS${ansi.reset}
  --seed-id <n>         seed_id of the tape (default: current seed_id; tape seed must match)
  --no-wait             Return after the API accepts the run
  --timeout <sec>       Max wait for a final status (default: 600)
  --json                Print one JSON line with the result

${ansi.bold}CLEANUP OPTIONS${ansi.reset}
  --dry-run             Show matching processes without terminating them
  --orphan-only         Only target orphaned runs (default unless --all)
  --all                 Target all matching kalien run processes
  --older-than <dur>    Minimum process age, e.g. 30s, 10m, 2h, 1d

${ansi.bold}EXAMPLES${ansi.reset}
  kalien whoami
  kalien run
  kalien run --threads 4
  kalien run --threads 25% --api-url http://localhost:8787
  kalien submit game.tape
  kalien status 01J...
  kalien key export > kalien-key-backup.txt
  kalien key import - < kalien-key-backup.txt
  kalien replay game.tape
  kalien cleanup --orphan-only --older-than 5m
`;

function parseArgs(argv: string[]): {
  command: string;
  args: Record<string, string>;
  positional: string[];
} {
  const booleanFlags = new Set([
    "help",
    "dry-run",
    "all",
    "orphan-only",
    "no-wait",
    "wait",
    "json",
  ]);
  const args: Record<string, string> = {};
  const positional: string[] = [];
  let command = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!command && !arg.startsWith("-")) {
      command = arg;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (booleanFlags.has(key)) {
        args[key] = "true";
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args[key] = argv[++i];
      }
    } else if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
    }
  }

  return { command, args, positional };
}

async function main(): Promise<void> {
  const { command, args, positional } = parseArgs(process.argv.slice(2));

  if (args["help"] || (!command && positional.length === 0)) {
    console.log(HELP);
    process.exit(0);
  }

  const keyPath = args["key"] ? resolve(args["key"]) : defaultKeyPath();
  const apiUrl = args["api-url"] || process.env.KALIEN_API_URL?.trim() || DEFAULT_API_URL;

  switch (command) {
    case "run": {
      if (args["address"]) {
        console.error(
          "Error: --address was removed. The CLI now signs runs with a local key; see `kalien whoami`.",
        );
        process.exit(1);
      }
      const identity = resolveIdentity(keyPath);

      const coreCount = cpus().length;
      const threads =
        args["threads"] === "max"
          ? coreCount
          : args["threads"]?.endsWith("%")
            ? Math.max(1, Math.round((coreCount * parseInt(args["threads"])) / 100))
            : args["threads"]
              ? parseInt(args["threads"], 10)
              : 0;

      await runCommand({ identity, threads, apiUrl });
      break;
    }

    case "submit": {
      const tapePath = positional[0];
      if (!tapePath) {
        console.error("Usage: kalien submit <tape-file> [--seed-id <n>]");
        process.exit(1);
      }
      const seedIdArg = args["seed-id"];
      const seedId = seedIdArg !== undefined ? Number.parseInt(seedIdArg, 10) : null;
      if (seedId !== null && (!Number.isInteger(seedId) || seedId < 0 || seedId > 0xffffffff)) {
        console.error("Error: --seed-id must be a u32");
        process.exit(1);
      }
      const timeoutSec = args["timeout"] ? Number.parseInt(args["timeout"], 10) : 600;
      const json = args["json"] === "true";
      await submitCommand({
        identity: resolveIdentity(keyPath, json),
        apiUrl,
        tapePath,
        seedId,
        wait: args["no-wait"] !== "true",
        timeoutMs: Math.max(1, timeoutSec) * 1000,
        json,
      });
      break;
    }

    case "status": {
      const runId = positional[0];
      if (!runId) {
        console.error("Usage: kalien status <run-id> [--wait]");
        process.exit(1);
      }
      await statusCommand(apiUrl, runId, args["wait"] === "true");
      break;
    }

    case "whoami": {
      await whoamiCommand(keyPath, apiUrl, args["json"] === "true");
      break;
    }

    case "key": {
      const action = positional[0] ?? "";
      let secret = positional[1];
      if (action === "import" && secret === "-") {
        secret = readFileSync(0, "utf-8").trim();
      }
      keyCommand(action, keyPath, secret);
      break;
    }

    case "replay": {
      const tapePath = positional[0];
      if (!tapePath) {
        console.error("Error: tape file path is required");
        console.error("Usage: kalien replay <tape-file>");
        process.exit(1);
      }

      await replayCommand(tapePath);
      break;
    }

    case "ps": {
      await psCommand();
      break;
    }

    case "cleanup": {
      await cleanupCommand({
        all: args["all"] === "true",
        dryRun: args["dry-run"] === "true",
        orphanOnly: args["all"] === "true" ? false : args["orphan-only"] !== "false",
        olderThan: args["older-than"] || null,
      });
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Fatal error: ${message}`);
  if (process.env.KALIEN_DEBUG === "1" && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
