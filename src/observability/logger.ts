import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env, type LogLevelName } from '../config/env.js';

type RequestContext = { requestId: string };
type LogFields = Record<string, unknown>;

const requestContext = new AsyncLocalStorage<RequestContext>();
const levelPriority: Record<LogLevelName, number> = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60
};

function timestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function fieldValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[A-Za-z0-9._:/@+-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

export function isLogLevelEnabled(level: LogLevelName): boolean {
  return levelPriority[level] >= levelPriority[env.logging.level];
}

function write(level: LogLevelName, message: string, fields: LogFields = {}): void {
  if (!isLogLevelEnabled(level)) return;
  const contextRequestId = requestContext.getStore()?.requestId;
  const allFields: LogFields = contextRequestId ? { request_id: contextRequestId, ...fields } : fields;
  const suffix = Object.entries(allFields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${fieldValue(value)}`)
    .join(' ');
  const output = `${timestamp()} ${level} ${message}${suffix ? ` ${suffix}` : ''}`;
  if (level === 'FATAL' || level === 'ERROR') console.error(output);
  else if (level === 'WARN') console.warn(output);
  else console.log(output);
}

function errorFields(error: unknown): LogFields {
  if (error === undefined || error === null) return {};
  if (!(error instanceof Error)) return { erro: String(error) };
  const databaseError = error as Error & { code?: string; errno?: number; sqlState?: string };
  const safeMessage = error.message
    .replace(/'[^']*'/g, "'<redacted>'")
    .replace(/0x[0-9a-f]{16,}/gi, '<redacted>');
  return {
    erro_tipo: error.name,
    erro: safeMessage,
    codigo: databaseError.code,
    errno: databaseError.errno,
    sql_state: databaseError.sqlState,
    stack: isLogLevelEnabled('DEBUG') ? error.stack?.replace(error.message, safeMessage) : undefined
  };
}

export function logTrace(message: string, fields?: LogFields): void {
  write('TRACE', message, fields);
}

export function logDebug(message: string, fields?: LogFields): void {
  write('DEBUG', message, fields);
}

export function logInfo(message: string, fields?: LogFields): void {
  write('INFO', message, fields);
}

export function logWarn(message: string, fields?: LogFields): void {
  write('WARN', message, fields);
}

export function logError(message: string, error?: unknown, fields: LogFields = {}): void {
  write('ERROR', message, { ...fields, ...errorFields(error) });
}

export function logFatal(message: string, error?: unknown, fields: LogFields = {}): void {
  write('FATAL', message, { ...fields, ...errorFields(error) });
}

function acceptedRequestId(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9._:-]{1,80}$/.test(value) ? value : undefined;
}

export function httpLogger(request: Request, response: Response, next: NextFunction): void {
  const requestId = acceptedRequestId(request.get('x-request-id')) ?? randomUUID();
  const startedAt = process.hrtime.bigint();

  requestContext.run({ requestId }, () => {
    response.setHeader('X-Request-Id', requestId);
    if (env.logging.http) {
      logInfo('Requisição recebida', {
        metodo: request.method,
        rota: request.originalUrl,
        content_type: request.get('content-type') ?? null,
        content_length: request.get('content-length') ?? null
      });
    }

    response.on('finish', () => {
      if (!env.logging.http) return;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const fields = {
        metodo: request.method,
        rota: request.originalUrl,
        status: response.statusCode,
        duracao_ms: Number(durationMs.toFixed(1))
      };
      if (response.statusCode >= 500) logError('Requisição concluída com erro', undefined, fields);
      else if (response.statusCode >= 400) logWarn('Requisição rejeitada', fields);
      else logInfo('Requisição concluída', fields);
    });

    next();
  });
}
