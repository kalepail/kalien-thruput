// Minimal Bun typings for `tsc -p kalien-contract` (the repo has no @types/bun).
interface ImportMeta {
  /** Directory of the current module (Bun). */
  readonly dir: string;
  /** True when this module is the entry point (Bun). */
  readonly main: boolean;
}

declare module "bun:test" {
  type Fn = () => void | Promise<void>;
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: Fn): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function expect(value: unknown): any;
}
