import { describe, expect, it } from "bun:test";
import { nowIso, parseBoolean, parseInteger, safeErrorMessage, sleep } from "../../worker/utils";

describe("worker utils", () => {
  it("nowIso returns a valid ISO string ending in Z", () => {
    const result = nowIso();
    expect(new Date(result).toISOString()).toBe(result);
  });

  it("parseInteger falls back on bad or small input", () => {
    expect(parseInteger(undefined, 7)).toBe(7);
    expect(parseInteger("12", 7)).toBe(12);
    expect(parseInteger("abc", 7)).toBe(7);
    expect(parseInteger("0", 7)).toBe(7);
    expect(parseInteger("0", 7, 0)).toBe(0);
  });

  it("parseBoolean reads common spellings", () => {
    expect(parseBoolean("1", false)).toBe(true);
    expect(parseBoolean("off", true)).toBe(false);
    expect(parseBoolean("maybe", true)).toBe(true);
    expect(parseBoolean(undefined, false)).toBe(false);
  });

  it("safeErrorMessage strips control characters", () => {
    expect(safeErrorMessage(new Error("a\u0000\u0001b"))).toBe("a b");
    expect(safeErrorMessage("plain")).toBe("plain");
  });

  it("sleep resolves", async () => {
    await sleep(1);
  });
});
