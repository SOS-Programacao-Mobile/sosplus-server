import 'dotenv/config';

export type LogLevelName = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`A variável de ambiente ${name} não foi configurada.`);
  }

  return value;
}

function booleanValue(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === undefined || value === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`A variável de ambiente ${name} deve ser true ou false.`);
}

function logLevelValue(): LogLevelName {
  const value = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG')).trim().toUpperCase();
  if (['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].includes(value)) return value as LogLevelName;
  throw new Error('A variável de ambiente LOG_LEVEL deve ser TRACE, DEBUG, INFO, WARN, ERROR ou FATAL.');
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  recoveryEnabled: booleanValue('RECOVERY_ENABLED', false),
  smtp: {
    host: process.env.SMTP_HOST ?? '127.0.0.1',
    port: Number(process.env.SMTP_PORT ?? 1025),
    from: process.env.SMTP_FROM ?? 'no-reply@sosplus.local'
  },
  logging: {
    level: logLevelValue(),
    http: booleanValue('LOG_HTTP', true),
    sql: booleanValue('LOG_SQL', process.env.NODE_ENV !== 'production')
  },
  // A migração de estrutura não cifra dados; por isso a chave é validada
  // somente ao iniciar a API ou ao operar o cadastro pessoal.
  personalDataEncryptionKey: process.env.PERSONAL_DATA_ENCRYPTION_KEY?.trim() ?? '',
  db: {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: required('MYSQL_DATABASE'),
    user: required('MYSQL_USER'),
    password: required('MYSQL_PASSWORD')
  }
};

if (env.recoveryEnabled && (process.env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '::1', 'mailpit'].includes(env.smtp.host))) {
  throw new Error('A recuperação desta entrega permite somente caixa de desenvolvimento local.');
}
