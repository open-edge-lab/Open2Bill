import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../auth';

// Genera l'hash della password per O2B_PASSWORD_HASH.
// Uso: npm run hash-password -w @open2bill/server

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Password: ');
rl.close();
if (password.length < 10) {
  console.error('Usa almeno 10 caratteri.');
  process.exit(1);
}
console.log(`\nO2B_PASSWORD_HASH=${hashPassword(password)}`);
