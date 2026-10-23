import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import type { SqlLike } from "../../../worker/relay/store";

type Value = string | number | bigint | boolean | null | Uint8Array;

function bindable(values: unknown[]): Value[] {
  return values.map((value) => (value === undefined ? null : (value as Value)));
}

/** Durable Object `ctx.storage.sql` shape over bun:sqlite. */
export function sqlLike(db = new Database(":memory:")): SqlLike {
  return {
    exec(query: string, ...bindings: unknown[]) {
      const rows = db.prepare(query).all(...bindable(bindings)) as never[];
      return { toArray: () => rows };
    },
  } as SqlLike;
}

class Statement {
  constructor(
    private readonly db: Database,
    readonly sql: string,
    readonly params: Value[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.db, this.sql, bindable(values));
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    return {
      results: this.db.prepare(this.sql).all(...this.params) as T[],
      success: true,
      meta: {},
    };
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    return this.runSync();
  }

  runSync(): { success: true; meta: { changes: number } } {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: result.changes } };
  }
}

/** Enough of D1Database for the Worker, over bun:sqlite, with the migrations applied. */
export function d1(): D1Database & { raw: Database } {
  const db = new Database(":memory:");
  const migration = readFileSync(
    join(import.meta.dir, "../../../worker/migrations/0001_init.sql"),
    "utf8",
  );
  db.exec(migration);
  return {
    raw: db,
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      return db.transaction(() => statements.map((statement) => statement.runSync()))();
    },
  } as unknown as D1Database & { raw: Database };
}
