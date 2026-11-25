import { createInterface } from 'node:readline/promises';
import { MIN_PASSWORD_LENGTH, hashPassword } from '../auth';

// Genera l'hash della password per O2B_PASSWORD_HASH.
// Uso: npm run hash-password -w @open2bill/server

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Password: ');
rl.close();
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Usa almeno ${MIN_PASSWORD_LENGTH} caratteri.`);
  process.exit(1);
}
console.log(`\nO2B_PASSWORD_HASH=${hashPassword(password)}`);
