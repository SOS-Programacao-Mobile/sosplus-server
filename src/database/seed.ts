import { seedDemo, seedReference } from './seeds.js';
import { seedShowcase } from './showcase-seeds.js';
import { closeDatabase } from './mysql.js';

try {
  if (process.argv.includes('--demo')) console.log(await seedDemo());
  else if (process.argv.includes('--showcase')) console.log(await seedShowcase());
  else { await seedReference(); console.log('Categorias de referência carregadas sem sobrescrita.'); }
} finally { await closeDatabase(); }
