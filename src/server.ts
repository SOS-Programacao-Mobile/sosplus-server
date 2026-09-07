import { app } from './app.js';
import { env } from './config/env.js';
import { closeDatabase } from './database/mysql.js';

function printBanner(port: number | string): void {
  // ANSI color codes matching the app's theme
  const purple = '\x1b[38;2;156;100;255m';  // RoxoClaro #9C64FF
  const red    = '\x1b[38;2;255;100;120m';  // Vermelho  #FF6478
  const white  = '\x1b[1;37m';              // Branco bold
  const dim    = '\x1b[2;37m';              // Cinza dim
  const reset  = '\x1b[0m';

  const banner = `
${purple}        ██████${red}  ██${purple}
      ██████████${red}████${purple}
      ████████████${red}██${purple}
  ████████████████████
  ████████████████████
  ████████████████████
████████████████████████
████████████████████████
████████████████████████
  ████████████████████
  ████████████████████
  ████████████████████
      ████████████
      ████████████
        ████████${reset}

${white}  ███████  ████████  ███████            
 ██       ██    ██ ██                   
  █████   ██    ██  █████    ██         
      ██  ██    ██      ██  ████        
 ███████  ████████ ███████   ██${reset}         

${dim}  Conectando pessoas. Transformando comunidades.${reset}
${dim}  ─────────────────────────────────────────────${reset}
${purple}  ▸${reset} API rodando em ${white}http://localhost:${port}${reset}
`;

  console.log(banner);
}

const server = app.listen(env.port, () => {
  printBanner(env.port);
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
