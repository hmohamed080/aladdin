/** The slice of Cloudflare D1 the admin, settings and maintenance modules use. D1Database satisfies it structurally. */
export type DbResult = { success: boolean; meta?: { changes?: number } };
export interface Bound {
  run(): Promise<DbResult>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface Db {
  prepare(sql: string): { bind(...values: (string | number | null)[]): Bound };
  /** Runs the statements in ONE transaction: all apply or none do. */
  batch(statements: Bound[]): Promise<DbResult[]>;
}
