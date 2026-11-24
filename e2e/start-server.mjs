// Avvia il server su una copia temporanea di examples/data (dati fittizi) per i test E2E.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open2bill-e2e-'));
fs.cpSync(path.join(root, 'examples', 'data'), dataDir, { recursive: true });

const webDir = path.join(root, 'apps', 'web', 'dist');
if (!fs.existsSync(path.join(webDir, 'index.html'))) {
  console.error('Manca la build della UI: esegui prima npm run build -w @open2bill/web');
  process.exit(1);
}

const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'apps', 'server', 'src', 'main.ts')], {
  stdio: 'inherit',
  env: { ...process.env, O2B_DATA_DIR: dataDir, O2B_PORT: '3299', O2B_HOST: '127.0.0.1', O2B_WEB_DIR: webDir },
});

const cleanup = () => {
  child.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
child.on('exit', (code) => process.exit(code ?? 0));
