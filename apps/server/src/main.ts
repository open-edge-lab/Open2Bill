import { readFileSync } from 'node:fs';
import { createServer } from './app';
import { loadConfig } from './config';

// Avvio in modalità server (sviluppo o web self-hosted).

/** Versione da apps/server/package.json, che sta un livello sopra sia src/ (sviluppo) sia dist/. */
function serverVersion(): string | undefined {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

async function main() {
  const config = loadConfig();
  const { app } = await createServer({
    dataDir: config.dataDir,
    webDir: config.webDir,
    auth: config.auth,
    trustProxy: config.trustProxy,
    localOnly: config.localOnly,
    logger: true,
    version: serverVersion(),
  });
  for (const w of config.warnings) app.log.warn(w);
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Cartella dati: ${config.dataDir}`);
  app.log.info(`Accesso: ${config.auth.mode === 'password' ? 'con password' : 'senza login (solo locale)'}`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
