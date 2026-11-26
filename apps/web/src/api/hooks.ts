import type { Catalog, Customer, Document } from '@open2bill/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { AppInfo, AuthStatus, DocumentDetails, DocumentSummary, IssueResult, IssuerResponse, Numbering } from './types';

export const keys = {
  app: ['app'] as const,
  auth: ['auth'] as const,
  issuer: ['issuer'] as const,
  customers: ['customers'] as const,
  catalog: ['catalog'] as const,
  documents: ['documents'] as const,
  document: (id: string) => ['documents', id] as const,
  numberingAll: ['numbering'] as const,
  numbering: (year: number) => ['numbering', year] as const,
};

export const useAppInfo = () => useQuery({ queryKey: keys.app, queryFn: () => api.get<AppInfo>('/api/app') });

export const useAuthStatus = () =>
  useQuery({ queryKey: keys.auth, queryFn: () => api.get<AuthStatus>('/api/auth/status'), retry: false });

export const useNumbering = (year: number, enabled = true) =>
  useQuery({
    queryKey: keys.numbering(year),
    queryFn: () => api.get<Numbering>(`/api/numbering?year=${year}`),
    enabled: enabled && Number.isInteger(year) && year >= 2000,
  });

export const useIssuer = (enabled = true) =>
  useQuery({ queryKey: keys.issuer, queryFn: () => api.get<IssuerResponse>('/api/issuer'), enabled, retry: false });

export const useCustomers = () =>
  useQuery({ queryKey: keys.customers, queryFn: () => api.get<Customer[]>('/api/customers') });

export const useCatalog = () => useQuery({ queryKey: keys.catalog, queryFn: () => api.get<Catalog>('/api/catalog') });

export const useDocuments = () =>
  useQuery({ queryKey: keys.documents, queryFn: () => api.get<DocumentSummary[]>('/api/documents') });

export const useDocument = (id: string | undefined) =>
  useQuery({
    queryKey: keys.document(id ?? ''),
    queryFn: () => api.get<DocumentDetails>(`/api/documents/${id}`),
    enabled: Boolean(id),
  });

/** Invalida elenco e dettaglio dei documenti dopo una modifica. */
export function useInvalidateDocuments() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.documents });
}

export function useDocumentAction<T = Document>(action: 'convert' | 'credit-note' | 'duplicate' | 'regenerate-pdf' | 'reopen') {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: (id: string) => api.post<T>(`/api/documents/${id}/${action}`),
    onSuccess: () => invalidate(),
  });
}

/**
 * Emissione: la bozza viene cancellata dal server, quindi non si invalida qui
 * (si ricaricherebbe una bozza inesistente). Ci pensa forgetDraft dopo la navigazione.
 */
export function useIssueDocument() {
  return useMutation({
    mutationFn: (id: string) => api.post<IssueResult>(`/api/documents/${id}/issue`),
  });
}

/** Dopo aver lasciato la pagina di una bozza eliminata/emessa: aggiorna l'elenco e dimentica la bozza. */
export function useForgetDraft() {
  const qc = useQueryClient();
  return (draftId: string) => {
    qc.removeQueries({ queryKey: keys.document(draftId), exact: true });
    void qc.invalidateQueries({ queryKey: keys.numberingAll });
    return qc.invalidateQueries({ queryKey: keys.documents });
  };
}
