import { closeDatabase } from '../mysql.js';
import { migrations } from './index.js';
import { getAppliedMigrations } from './migrator.js';

try {
  const applied = new Map((await getAppliedMigrations()).map((migration) => [migration.id, migration]));

  for (const migration of migrations) {
    const item = applied.get(migration.id);
    console.log(
      item
        ? `APLICADA  ${migration.id} — ${migration.description}`
        : `PENDENTE  ${migration.id} — ${migration.description}`
    );
  }
} finally {
  await closeDatabase();
}
