import { existsSync } from "fs";
import { KalienApi } from "../api/client";
import {
  exportSecret,
  importIdentity,
  keyFileIsExposed,
  loadOrCreateIdentity,
  parseSecretKey,
  readKeyFile,
  type Identity,
  type SecretFormat,
} from "../identity/keyfile";
import * as ansi from "../display/ansi";

/** Load the key file, make it on first run, and warn about loose file modes. */
export function resolveIdentity(keyPath: string, quiet = false): Identity {
  const { identity, created } = loadOrCreateIdentity(keyPath);
  if (created && !quiet) {
    console.error(ansi.color(ansi.green, `  Created new player key: ${keyPath}`));
    console.error(ansi.color(ansi.dim, "  Back it up with: kalien key export"));
  }
  if (keyFileIsExposed(keyPath)) {
    console.error(
      ansi.color(ansi.yellow, `  Warning: ${keyPath} is readable by other users; run chmod 600`),
    );
  }
  return identity;
}

export async function whoamiCommand(keyPath: string, apiUrl: string, json: boolean): Promise<void> {
  const identity = resolveIdentity(keyPath, json);
  let explorerUrl = "";
  try {
    explorerUrl = (await new KalienApi(apiUrl).config()).explorerUrl;
  } catch {}
  if (json) {
    console.log(
      JSON.stringify({
        address: identity.address,
        publicKey: identity.publicKeyBase58,
        publicKeyHex: identity.publicKeyHex,
        keyFile: keyPath,
      }),
    );
    return;
  }
  console.log(`  ${ansi.color(ansi.gray, "Address:")}    ${identity.address}`);
  console.log(`  ${ansi.color(ansi.gray, "Public key:")} ${identity.publicKeyBase58}`);
  console.log(`  ${ansi.color(ansi.gray, "Key file:")}   ${keyPath}`);
  if (explorerUrl) {
    console.log(
      `  ${ansi.color(ansi.gray, "Explorer:")}   ${explorerUrl.replace(/\/+$/, "")}/address/${identity.address}`,
    );
  }
}

export function keyCommand(
  action: string,
  keyPath: string,
  secretArg: string | undefined,
  format: string = "hex",
): void {
  switch (action) {
    case "path":
      console.log(keyPath);
      return;
    case "export": {
      if (!existsSync(keyPath)) throw new Error(`no key file at ${keyPath}`);
      // Validate before printing so a corrupt file fails loudly.
      readKeyFile(keyPath);
      console.error(
        ansi.color(
          ansi.yellow,
          "  This is your player secret key. Anyone with it controls your runs.",
        ),
      );
      if (format !== "hex" && format !== "base58" && format !== "strkey") {
        throw new Error("--format must be hex, base58, or strkey");
      }
      console.log(exportSecret(keyPath, format as SecretFormat));
      return;
    }
    case "import": {
      const raw = secretArg ?? process.env.KALIEN_SECRET_KEY;
      if (!raw) {
        throw new Error("usage: kalien key import <secret|-> (or set KALIEN_SECRET_KEY)");
      }
      const identity = importIdentity(keyPath, parseSecretKey(raw));
      console.log(`  ${ansi.color(ansi.green, "Imported key")} -> ${keyPath}`);
      console.log(`  ${ansi.color(ansi.gray, "Address:")} ${identity.address}`);
      return;
    }
    case "new": {
      const { identity, created } = loadOrCreateIdentity(keyPath);
      if (!created) throw new Error(`key file ${keyPath} already exists`);
      console.log(`  ${ansi.color(ansi.green, "Created key")} -> ${keyPath}`);
      console.log(`  ${ansi.color(ansi.gray, "Address:")} ${identity.address}`);
      return;
    }
    default:
      throw new Error("usage: kalien key <path|export|import|new>");
  }
}
