// Avvia l'ambiente di sviluppo sui dati FITTIZI di esempio, copiati in una cartella
// temporanea (così examples/data resta pulita). Per ripartire da zero: --reset
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(os.tmpdir(), 'open2bill-example-data');

if (process.argv.includes('--reset')) fs.rmSync(target, { recursive: true, force: true });
if (!fs.existsSync(target)) fs.cpSync(path.join(root, 'examples', 'data'), target, { recursive: true });
console.log(`Dati di esempio in ${target}`);

const child = spawn('npm', ['run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, O2B_DATA_DIR: target },
});
child.on('exit', (code) => process.exit(code ?? 0));
