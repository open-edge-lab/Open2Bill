import type { Document, DocumentKind, DocumentStatus, Issuer, NumberingSeries, Totals, ValidationIssue } from '@open2bill/core';

// Forme delle risposte dell'API (vedi apps/server/src/routes/api.ts).

export interface AppInfo {
  version: string;
  desktop: boolean;
  pdfAvailable: boolean;
  hasIssuer: boolean;
  dataDir?: string;
}

export interface AuthStatus {
  mode: 'none' | 'token' | 'password';
  authenticated: boolean;
}

export interface IssuerResponse {
  issuer: Issuer;
  issues: ValidationIssue[];
  /** Bozze che hanno preso la nuova banca (solo dopo un salvataggio). */
  updatedDrafts?: number;
}

export interface SeriesNumbering {
  /** Ultimo numero usato (emesso qui o impostato a mano). */
  lastUsed: number;
  /** Prossimo numero proposto, e lo stesso già formattato. */
  next: number;
  nextNumber: string;
  /** Il prossimo numero non può scendere sotto questo. */
  minNext: number;
}

export interface Numbering {
  year: number;
  series: Record<NumberingSeries, SeriesNumbering>;
}

export interface DocumentDetails {
  document: Document;
  totals: Totals;
  issues: ValidationIssue[];
}

export interface DocumentSummary {
  id: string;
  type: DocumentKind;
  status: DocumentStatus;
  number?: string;
  date: string;
  customerName: string;
  documentTotal: string;
  netPayable: string;
  xmlFileName?: string;
  pdfFileName?: string;
  convertedToId?: string;
  sourceProformaId?: string;
}

export interface IssueResult {
  document: Document;
  warnings: string[];
}

export interface FullValidation extends DocumentDetails {
  ok: boolean;
  xsd?: { valid: boolean; version: string; errors: string[] };
}
