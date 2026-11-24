import { formatAmount, formatItalianDate } from '@open2bill/core';

export const euro = (value: string | number | null | undefined): string =>
  value === null || value === undefined || value === '' ? '—' : `€ ${formatAmount(value)}`;

export const itDate = (iso: string | null | undefined): string => (iso ? formatItalianDate(iso) : '—');

export { formatAmount };
