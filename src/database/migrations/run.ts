import { closeDatabase } from '../mysql.js';
import { runMigrations } from './migrator.js';

try {
  const executed = await runMigrations();

  if (executed.length === 0) {
    console.log('O banco já está atualizado.');
  } else {
    console.log(`Migrações aplicadas: ${executed.join(', ')}`);
  }
} finally {
  await closeDatabase();
}
