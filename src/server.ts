import { app } from './app.js';
import { env } from './config/env.js';
import { closeDatabase } from './database/mysql.js';

const server = app.listen(env.port, () => {
  console.log(`SOSPlus API disponível em http://localhost:${env.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} recebido. Encerrando API...`);
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
