import crypto from 'node:crypto';
import path from 'node:path';
import { Document as YamlDocument } from 'yaml';
import { z } from 'zod';
import { fileExists, readYaml, writeFileAtomic } from './storage/yaml-file';

// Password cambiata dall'interfaccia (web self-hosted, modalità "password").
//
// La password iniziale è quella di O2B_PASSWORD_HASH. Quando la si cambia da Impostazioni, il
// nuovo hash va in auth.yaml nella cartella dati, con l'impronta dell'O2B_PASSWORD_HASH in
// vigore in quel momento. Se poi chi gestisce il server imposta un altro O2B_PASSWORD_HASH,
// per esempio perché la password è stata dimenticata, l'impronta non combacia più e auth.yaml
// viene ignorato: O2B_PASSWORD_HASH resta sempre il modo per riprendere l'accesso.

const SavedPasswordSchema = z.object({
  passwordHash: z.string().startsWith('scrypt$'),
  replaces: z.string().min(1),
});

/** Impronta di un hash: basta a riconoscerlo senza ripeterlo. */
function fingerprint(hash: string): string {
  return crypto.createHash('sha256').update(hash).digest('base64url').slice(0, 22);
}

export interface SavedPassword {
  /** Hash salvato da usare al posto di O2B_PASSWORD_HASH, o null se non c'è o non vale. */
  hash: string | null;
  /** Perché un auth.yaml presente non viene usato. */
  warning?: string;
}

export async function loadSavedPassword(file: string, configuredHash: string): Promise<SavedPassword> {
  if (!(await fileExists(file))) return { hash: null };
  const name = path.basename(file);
  const parsed = SavedPasswordSchema.safeParse(await readYaml(file).catch(() => null));
  if (!parsed.success) {
    return { hash: null, warning: `${name} non valido: vale la password di O2B_PASSWORD_HASH` };
  }
  if (parsed.data.replaces !== fingerprint(configuredHash)) {
    return {
      hash: null,
      warning: `O2B_PASSWORD_HASH è cambiato dopo l'ultimo cambio password: ${name} viene ignorato`,
    };
  }
  return { hash: parsed.data.passwordHash };
}

export async function savePassword(file: string, hash: string, configuredHash: string): Promise<void> {
  const doc = new YamlDocument({
    passwordHash: hash,
    replaces: fingerprint(configuredHash),
    changedAt: new Date().toISOString(),
  });
  doc.commentBefore =
    ' Password di accesso cambiata da Open2Bill: è un hash scrypt, non la password.\n' +
    ' Cancella questo file per tornare alla password di O2B_PASSWORD_HASH.';
  await writeFileAtomic(file, doc.toString({ lineWidth: 0 }), { mode: 0o600 });
}
