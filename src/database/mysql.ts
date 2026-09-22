import mysql from 'mysql2/promise';
import type { SqlValue } from 'mysql2';
import { env } from '../config/env.js';
import { logDebug, logError, logTrace } from '../observability/logger.js';

const databasePool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true
});

type MutableTarget = Record<string, unknown>;
type AsyncMethod = (...args: unknown[]) => Promise<unknown>;
const instrumentedConnections = new WeakSet<object>();

function sqlText(value: unknown): string {
  const raw = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && 'sql' in value
      ? String((value as { sql: unknown }).sql)
      : '<SQL indisponível>';
  return raw.replace(/\s+/g, ' ').trim();
}

function safeParameter(value: unknown): SqlValue {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number') return '<number>';
  if (typeof value === 'boolean') return '<boolean>';
  if (typeof value === 'bigint') return `<bigint:${value.toString().length} dígitos>`;
  if (value instanceof Date) return '<date>';
  if (Buffer.isBuffer(value)) return `<buffer:${value.length} bytes>`;
  if (typeof value === 'string') return `<string:${value.length} caracteres>`;
  if (Array.isArray(value)) return value.map(safeParameter);
  return `<${typeof value}>`;
}

function parametersFrom(args: unknown[]): SqlValue[] | undefined {
  const values = args[1];
  if (values === undefined) return undefined;
  return Array.isArray(values) ? values.map(safeParameter) : [safeParameter(values)];
}

function formattedSql(args: unknown[]): string {
  const statement = sqlText(args[0]);
  const parameters = parametersFrom(args);
  return parameters ? mysql.format(statement, parameters) : statement;
}

function resultSummary(result: unknown): Record<string, unknown> {
  if (!Array.isArray(result)) return {};
  const rows = result[0];
  if (Array.isArray(rows)) return { linhas_retornadas: rows.length };
  if (rows && typeof rows === 'object') {
    const header = rows as { affectedRows?: number; insertId?: number | string; changedRows?: number };
    return {
      linhas_afetadas: header.affectedRows,
      linhas_alteradas: header.changedRows,
      id_gerado: header.insertId === undefined ? undefined : '<generated>'
    };
  }
  return {};
}

function wrapSqlMethod(target: object, method: 'query' | 'execute'): void {
  const mutable = target as MutableTarget;
  const original = (mutable[method] as AsyncMethod).bind(target);
  mutable[method] = async (...args: unknown[]) => {
    if (!env.logging.sql) return original(...args);
    const startedAt = process.hrtime.bigint();
    const fields = { operacao: method, sql: formattedSql(args) };
    logTrace('SQL iniciado', fields);
    try {
      const result = await original(...args);
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logDebug('SQL executado', {
        ...fields,
        ...resultSummary(result),
        duracao_ms: Number(durationMs.toFixed(1))
      });
      return result;
    } catch (error) {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logError('Falha ao executar SQL', error, {
        ...fields,
        duracao_ms: Number(durationMs.toFixed(1))
      });
      throw error;
    }
  };
}

function wrapTransactionMethod(target: object, method: 'beginTransaction' | 'commit' | 'rollback', sql: string): void {
  const mutable = target as MutableTarget;
  const original = (mutable[method] as AsyncMethod).bind(target);
  mutable[method] = async (...args: unknown[]) => {
    if (!env.logging.sql) return original(...args);
    const startedAt = process.hrtime.bigint();
    try {
      const result = await original(...args);
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logDebug('Transação SQL executada', { sql, duracao_ms: Number(durationMs.toFixed(1)) });
      return result;
    } catch (error) {
      logError('Falha na transação SQL', error, { sql });
      throw error;
    }
  };
}

function instrumentConnection(connection: object): void {
  if (instrumentedConnections.has(connection)) return;
  instrumentedConnections.add(connection);
  wrapSqlMethod(connection, 'query');
  wrapSqlMethod(connection, 'execute');
  wrapTransactionMethod(connection, 'beginTransaction', 'BEGIN');
  wrapTransactionMethod(connection, 'commit', 'COMMIT');
  wrapTransactionMethod(connection, 'rollback', 'ROLLBACK');
}

wrapSqlMethod(databasePool, 'query');
wrapSqlMethod(databasePool, 'execute');
const mutablePool = databasePool as unknown as MutableTarget;
const originalGetConnection = (mutablePool.getConnection as AsyncMethod).bind(databasePool);
mutablePool.getConnection = async () => {
  const connection = await originalGetConnection();
  instrumentConnection(connection as object);
  return connection;
};

export const database = databasePool;

export async function closeDatabase(): Promise<void> {
  await database.end();
}
