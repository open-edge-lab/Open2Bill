import { createServer } from './app';
import { loadConfig } from './config';

// Avvio in modalità server (sviluppo o web self-hosted).

async function main() {
  const config = loadConfig();
  const { app } = await createServer({
    dataDir: config.dataDir,
    webDir: config.webDir,
    auth: config.auth,
    trustProxy: config.trustProxy,
    localOnly: config.localOnly,
    logger: true,
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
