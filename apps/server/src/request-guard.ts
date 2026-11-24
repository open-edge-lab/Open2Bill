import type { FastifyInstance, FastifyRequest } from 'fastify';

// Difese che valgono prima del login, in tutte le modalità.
//
// - DNS rebinding: un sito malevolo può far risolvere il proprio dominio a 127.0.0.1 e
//   parlare con il server locale come se fosse la stessa origine. L'header Host però resta
//   il suo dominio: quando il server ascolta solo in locale si accettano solo localhost,
//   127.0.0.1 e ::1. Senza questo controllo, in sviluppo (nessun login) i dati reali
//   sarebbero leggibili da qualsiasi pagina aperta nel browser.
// - CSRF: un'altra pagina può inviare un POST "semplice" senza preflight, per esempio per
//   emettere una bozza. Le richieste che modificano dati devono arrivare dalla stessa origine.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Nome host senza porta: "localhost:3210" → "localhost", "[::1]:3210" → "::1". */
export function hostnameOf(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(1, end) : value;
  }
  const colon = value.indexOf(':');
  // più di un ":" senza parentesi: IPv6 nudo, lo si lascia com'è
  return colon >= 0 && colon === value.lastIndexOf(':') ? value.slice(0, colon) : value;
}

/** Host con porta, senza le porte predefinite: "Example.com:443" → "example.com". */
function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:(80|443)$/, '');
}

// Stessa origine = stesso host E stessa porta: un'altra app su localhost:8080 non deve
// poter modificare i dati del server su localhost:3210 (in locale non c'è login).
function isCrossSite(req: FastifyRequest): boolean {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') return true;
  const origin = req.headers.origin;
  if (!origin) return false; // client che non sono browser (curl, test)
  try {
    return normalizeHost(new URL(origin).host) !== normalizeHost(req.host);
  } catch {
    return true; // "null" (iframe sandbox, file://) o valori non validi
  }
}

export interface RequestGuardOptions {
  /** Il server ascolta solo su un indirizzo locale: Host ammessi solo di loopback. */
  localOnly: boolean;
}

export function registerRequestGuards(app: FastifyInstance, options: RequestGuardOptions): void {
  app.addHook('onRequest', async (req, reply) => {
    if (options.localOnly && !LOOPBACK_HOSTS.has(hostnameOf(req.headers.host ?? ''))) {
      return reply
        .code(421)
        .send({ error: 'host_not_allowed', message: 'Host non ammesso: il server accetta solo richieste locali' });
    }
    if (!SAFE_METHODS.has(req.method) && isCrossSite(req)) {
      return reply.code(403).send({ error: 'cross_site_request', message: 'Richiesta da un altro sito rifiutata' });
    }
  });
}
