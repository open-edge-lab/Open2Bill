import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// Accesso all'API:
// - "none": nessun controllo (solo per sviluppo locale);
// - "token": app desktop, Electron imposta un cookie con un token casuale per sessione;
// - "password": web self-hosted, password unica (hash scrypt) e cookie di sessione firmato.

export type AuthConfig =
  | { mode: 'none' }
  | { mode: 'token'; token: string }
  | { mode: 'password'; passwordHash: string; sessionSecret: string; sessionDays?: number };

export const SESSION_COOKIE = 'o2b_session';
export const DESKTOP_COOKIE = 'o2b_token';

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

function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createSession(secret: string, days: number): string {
  const expires = Date.now() + days * 86_400_000;
  const payload = `${expires}.${crypto.randomBytes(12).toString('base64url')}`;
  return `${payload}.${sign(payload, secret)}`;
}

function isValidSession(cookie: string | undefined, secret: string): boolean {
  if (!cookie) return false;
  const idx = cookie.lastIndexOf('.');
  if (idx <= 0) return false;
  const payload = cookie.slice(0, idx);
  const signature = cookie.slice(idx + 1);
  const expected = sign(payload, secret);
  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  return Number(payload.split('.')[0]) > Date.now();
}

function safeEqual(a: string | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function isAuthenticated(req: FastifyRequest, auth: AuthConfig): boolean {
  switch (auth.mode) {
    case 'none':
      return true;
    case 'token':
      return safeEqual(req.cookies[DESKTOP_COOKIE], auth.token);
    case 'password':
      return isValidSession(req.cookies[SESSION_COOKIE], auth.sessionSecret);
  }
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

export function registerAuth(app: FastifyInstance, auth: AuthConfig): void {
  // Tentativi di login falliti: piccolo ritardo crescente per IP.
  const failures = new Map<string, { count: number; until: number }>();

  // La decisione si basa sulla rotta trovata dal router, non sull'URL grezzo: il router
  // decodifica %xx, quindi "/%61pi/issuer" arriva alla rotta /api/issuer pur non iniziando
  // con "/api/". Ogni rotta API richiede il login, tranne quelle in PUBLIC_ROUTES.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const route = req.routeOptions.url;
    const needsAuth = route === undefined ? looksLikeApi(req.url) : isApiRoute(route) && !PUBLIC_ROUTES.has(route);
    if (needsAuth && !isAuthenticated(req, auth)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Accesso richiesto' });
    }
  });

  app.get('/api/auth/status', async (req) => ({
    mode: auth.mode,
    authenticated: isAuthenticated(req, auth),
  }));

  app.post<{ Body: { password?: string } }>('/api/auth/login', async (req, reply) => {
    if (auth.mode !== 'password') return reply.code(400).send({ error: 'bad_request', message: 'Login non previsto' });
    const ip = req.ip;
    const f = failures.get(ip);
    if (f && f.until > Date.now()) {
      return reply.code(429).send({ error: 'too_many_attempts', message: 'Troppi tentativi, riprova tra poco' });
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!verifyPassword(password, auth.passwordHash)) {
      const count = (f?.count ?? 0) + 1;
      failures.set(ip, { count, until: Date.now() + Math.min(60_000, 500 * 2 ** count) });
      return reply.code(401).send({ error: 'invalid_password', message: 'Password errata' });
    }
    failures.delete(ip);
    const days = auth.sessionDays ?? 30;
    reply.setCookie(SESSION_COOKIE, createSession(auth.sessionSecret, days), {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      maxAge: days * 86_400,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
