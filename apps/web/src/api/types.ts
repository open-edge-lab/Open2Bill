import type { Document, DocumentKind, DocumentStatus, Issuer, Totals, ValidationIssue } from '@open2bill/core';

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
