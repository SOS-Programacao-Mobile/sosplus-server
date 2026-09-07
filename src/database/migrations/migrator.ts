import type { RowDataPacket } from 'mysql2';
import { database } from '../mysql.js';
import { migrations } from './index.js';

type AppliedMigration = RowDataPacket & {
  id: string;
  description: string;
  appliedAt: Date;
};

async function ensureMigrationsTable(): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(100) NOT NULL,
      description VARCHAR(255) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function getAppliedMigrations(): Promise<AppliedMigration[]> {
  await ensureMigrationsTable();

  const [rows] = await database.query<AppliedMigration[]>(`
    SELECT id, description, applied_at AS appliedAt
    FROM schema_migrations
    ORDER BY id
  `);

  return rows;
}

export async function runMigrations(): Promise<string[]> {
  await ensureMigrationsTable();

  const connection = await database.getConnection();

  try {
    const [lockRows] = await connection.query<RowDataPacket[]>(
      "SELECT GET_LOCK('sosplus_schema_migrations', 10) AS acquired"
    );

    if (lockRows[0]?.acquired !== 1) {
      throw new Error('Não foi possível obter o bloqueio de migrações.');
    }

    const [appliedRows] = await connection.query<AppliedMigration[]>(
      'SELECT id, description, applied_at AS appliedAt FROM schema_migrations'
    );
    const appliedIds = new Set(appliedRows.map((migration) => migration.id));
    const executed: string[] = [];

    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) {
        continue;
      }

      await migration.up(connection);
      await connection.execute(
        'INSERT INTO schema_migrations (id, description) VALUES (?, ?)',
        [migration.id, migration.description]
      );
      executed.push(migration.id);
    }

    return executed;
  } finally {
    await connection.query("SELECT RELEASE_LOCK('sosplus_schema_migrations')").catch(() => undefined);
    connection.release();
  }
}
