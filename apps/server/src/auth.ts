import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loadSavedPassword, savePassword } from './password-file';

// Accesso all'API:
// - "none": nessun controllo (solo per sviluppo locale);
// - "token": app desktop, Electron imposta un cookie con un token casuale per sessione;
// - "password": web self-hosted, password unica (hash scrypt) e cookie di sessione firmato.
//   La password si può cambiare dall'interfaccia (vedi password-file.ts).

export type AuthConfig =
  | { mode: 'none' }
  | { mode: 'token'; token: string }
  | { mode: 'password'; passwordHash: string; sessionSecret: string; sessionDays?: number };

export interface AuthOptions {
  /** Dove salvare la password cambiata dall'interfaccia (modalità "password"). */
  passwordFile?: string;
}

export const SESSION_COOKIE = 'o2b_session';
export const DESKTOP_COOKIE = 'o2b_token';

export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 256;

/** Hash nel formato "scrypt$<salt base64>$<hash base64>". */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Chiave che firma i cookie di sessione. Dipende anche dall'hash della password, così
 * cambiarla invalida tutte le sessioni aperte con quella vecchia.
 */
function sessionKey(secret: string, passwordHash: string): Buffer {
  return crypto.createHmac('sha256', secret).update(`session\0${passwordHash}`).digest();
}

function sign(value: string, key: Buffer): string {
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}

function createSession(key: Buffer, days: number): string {
  const expires = Date.now() + days * 86_400_000;
  const payload = `${expires}.${crypto.randomBytes(12).toString('base64url')}`;
  return `${payload}.${sign(payload, key)}`;
}

function isValidSession(cookie: string | undefined, key: Buffer): boolean {
  if (!cookie) return false;
  const idx = cookie.lastIndexOf('.');
  if (idx <= 0) return false;
  const payload = cookie.slice(0, idx);
  const signature = cookie.slice(idx + 1);
  const expected = sign(payload, key);
  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  return Number(payload.split('.')[0]) > Date.now();
}

function safeEqual(a: string | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Rotte API raggiungibili senza login, per pattern di rotta.
const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/logout']);

const isApiRoute = (route: string) => route === '/api' || route.startsWith('/api/');

/** Percorso decodificato di una richiesta che non corrisponde a nessuna rotta. */
function looksLikeApi(rawUrl: string): boolean {
  let pathname = rawUrl.split(/[?#]/, 1)[0] ?? '';
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // codifica non valida: si valuta il percorso così com'è
  }
  return /^\/+api(\/|$)/i.test(pathname);
}

export async function registerAuth(app: FastifyInstance, auth: AuthConfig, options: AuthOptions = {}): Promise<void> {
  // Modalità "password": hash in uso e chiave delle sessioni, che cambiano insieme.
  let password: { hash: string; key: Buffer } | null = null;
  if (auth.mode === 'password') {
    let hash = auth.passwordHash;
    if (options.passwordFile) {
      const saved = await loadSavedPassword(options.passwordFile, auth.passwordHash);
      if (saved.warning) app.log.warn(saved.warning);
      hash = saved.hash ?? hash;
    }
    password = { hash, key: sessionKey(auth.sessionSecret, hash) };
  }

  function isAuthenticated(req: FastifyRequest): boolean {
    switch (auth.mode) {
      case 'none':
        return true;
      case 'token':
        return safeEqual(req.cookies[DESKTOP_COOKIE], auth.token);
      case 'password':
        return password !== null && isValidSession(req.cookies[SESSION_COOKIE], password.key);
    }
  }

  function startSession(req: FastifyRequest, reply: FastifyReply, key: Buffer, days: number): void {
    reply.setCookie(SESSION_COOKIE, createSession(key, days), {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      maxAge: days * 86_400,
    });
  }

  // Password sbagliate (login o cambio password): piccolo ritardo crescente per IP.
  const failures = new Map<string, { count: number; until: number }>();
  const isThrottled = (ip: string) => (failures.get(ip)?.until ?? 0) > Date.now();
  const recordFailure = (ip: string) => {
    const count = (failures.get(ip)?.count ?? 0) + 1;
    failures.set(ip, { count, until: Date.now() + Math.min(60_000, 500 * 2 ** count) });
  };
  const tooManyAttempts = (reply: FastifyReply) =>
    reply.code(429).send({ error: 'too_many_attempts', message: 'Troppi tentativi, riprova tra poco' });

  // La decisione si basa sulla rotta trovata dal router, non sull'URL grezzo: il router
  // decodifica %xx, quindi "/%61pi/issuer" arriva alla rotta /api/issuer pur non iniziando
  // con "/api/". Ogni rotta API richiede il login, tranne quelle in PUBLIC_ROUTES.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const route = req.routeOptions.url;
    const needsAuth = route === undefined ? looksLikeApi(req.url) : isApiRoute(route) && !PUBLIC_ROUTES.has(route);
    if (needsAuth && !isAuthenticated(req)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Accesso richiesto' });
    }
  });

  app.get('/api/auth/status', async (req) => ({
    mode: auth.mode,
    authenticated: isAuthenticated(req),
  }));

  app.post<{ Body: { password?: string } }>('/api/auth/login', async (req, reply) => {
    if (auth.mode !== 'password' || !password) {
      return reply.code(400).send({ error: 'bad_request', message: 'Login non previsto' });
    }
    if (isThrottled(req.ip)) return tooManyAttempts(reply);
    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!verifyPassword(given, password.hash)) {
      recordFailure(req.ip);
      return reply.code(401).send({ error: 'invalid_password', message: 'Password errata' });
    }
    failures.delete(req.ip);
    startSession(req, reply, password.key, auth.sessionDays ?? 30);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Cambio password: serve la sessione (non è tra le rotte pubbliche) e la password attuale.
  // Chi la cambia resta dentro con un cookie nuovo; le altre sessioni si chiudono.
  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>('/api/auth/password', async (req, reply) => {
    const { passwordFile } = options;
    if (auth.mode !== 'password' || !password || !passwordFile) {
      return reply.code(400).send({ error: 'bad_request', message: 'Cambio password non previsto' });
    }
    if (isThrottled(req.ip)) return tooManyAttempts(reply);
    const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const next = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    if (!verifyPassword(current, password.hash)) {
      recordFailure(req.ip);
      return reply.code(403).send({ error: 'invalid_password', message: 'La password attuale non è corretta' });
    }
    failures.delete(req.ip);
    if (next.length < MIN_PASSWORD_LENGTH || next.length > MAX_PASSWORD_LENGTH) {
      return reply.code(400).send({
        error: 'weak_password',
        message: `La nuova password deve avere da ${MIN_PASSWORD_LENGTH} a ${MAX_PASSWORD_LENGTH} caratteri`,
      });
    }
    const hash = hashPassword(next);
    await savePassword(passwordFile, hash, auth.passwordHash);
    password = { hash, key: sessionKey(auth.sessionSecret, hash) };
    startSession(req, reply, password.key, auth.sessionDays ?? 30);
    return { ok: true };
  });
}
