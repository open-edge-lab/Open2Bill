import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuthConfig } from './auth';

// Configurazione da variabili d'ambiente per la modalità server (web self-hosted).
//
//   O2B_DATA_DIR        cartella dati (default: ~/Documents/Open2Bill)
//   O2B_HOST, O2B_PORT  indirizzo di ascolto (default: 127.0.0.1:3210)
//   O2B_WEB_DIR         build della UI (default: apps/web/dist)
//   O2B_PASSWORD_HASH   abilita il login (genera l'hash con: npm run hash-password -w @open2bill/server)
//   O2B_SESSION_SECRET  segreto per firmare i cookie di sessione
//   O2B_AUTH=none       disattiva il login (ammesso solo su indirizzi locali)
//   O2B_TRUST_PROXY=1   dietro nginx/HTTPS
//   O2B_CHROME_PATH     browser Chromium per i PDF

export interface RuntimeConfig {
  dataDir: string;
  host: string;
  port: number;
  webDir: string;
  auth: AuthConfig;
  trustProxy: boolean;
  /** In ascolto solo su loopback: si accettano solo Host locali (contro il DNS rebinding). */
  localOnly: boolean;
  warnings: string[];
}

export function defaultDataDir(): string {
  return path.join(os.homedir(), 'Documents', 'Open2Bill');
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const warnings: string[] = [];
  const host = env.O2B_HOST ?? '127.0.0.1';
  const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(host);

  let auth: AuthConfig;
  if (env.O2B_PASSWORD_HASH) {
    let secret = env.O2B_SESSION_SECRET;
    if (!secret) {
      secret = crypto.randomBytes(32).toString('base64url');
      warnings.push('O2B_SESSION_SECRET non impostato: le sessioni scadranno a ogni riavvio');
    }
    auth = { mode: 'password', passwordHash: env.O2B_PASSWORD_HASH, sessionSecret: secret };
  } else {
    if (!isLocal) {
      throw new Error(
        `Il server ascolta su ${host} senza password. Imposta O2B_PASSWORD_HASH (npm run hash-password -w @open2bill/server).`,
      );
    }
    auth = { mode: 'none' };
  }

  return {
    dataDir: path.resolve(env.O2B_DATA_DIR ?? defaultDataDir()),
    host,
    port: Number(env.O2B_PORT ?? 3210),
    webDir: path.resolve(env.O2B_WEB_DIR ?? path.join(here, '..', '..', 'web', 'dist')),
    auth,
    trustProxy: env.O2B_TRUST_PROXY === '1' || env.O2B_TRUST_PROXY === 'true',
    localOnly: isLocal,
    warnings,
  };
}
