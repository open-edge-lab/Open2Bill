import type { ValidationIssue } from '@open2bill/core';

// Client HTTP minimale per l'API di Open2Bill (stessa origine, cookie di sessione).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: ValidationIssue[] = [],
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

export const UNAUTHORIZED_EVENT = 'o2b:unauthorized';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) {
    let payload: { error?: string; message?: string; issues?: ValidationIssue[]; details?: string[] } = {};
    try {
      payload = await res.json();
    } catch {
      // risposta non JSON
    }
    throw new ApiError(
      res.status,
      payload.error ?? 'http_error',
      payload.message ?? `Errore ${res.status}`,
      payload.issues ?? [],
      payload.details ?? [],
    );
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: (url: string) => request<void>('DELETE', url),
};

/** Messaggio leggibile da qualsiasi errore. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.details.length) return `${err.message}: ${err.details.join('; ')}`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
