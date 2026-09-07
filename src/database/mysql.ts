import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

export const database = mysql.createPool({
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

export async function closeDatabase(): Promise<void> {
  await database.end();
}
