/** Minimal structural subset shared by Cloudflare D1 and the local SQLite adapter. */
export type SqlValue = string | number | null;
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}
export interface D1PreparedStatement {
  bind(...values: SqlValue[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}
export interface SqlStatement { sql: string; values: SqlValue[] }
export interface Env { DB: D1Database }
