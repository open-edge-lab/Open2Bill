import { Badge } from '@mantine/core';
import { DOCUMENT_STATUS_LABELS, type DocumentStatus } from '@open2bill/core';

const COLORS: Record<DocumentStatus, string> = {
  draft: 'gray',
  issued: 'ink',
  uploaded: 'stamp',
};

export function StatusBadge({
  status,
  proforma = false,
  converted = false,
}: {
  status: DocumentStatus;
  proforma?: boolean;
  converted?: boolean;
}) {
  let label: string = DOCUMENT_STATUS_LABELS[status];
  if (proforma && status === 'issued') label = converted ? 'Convertita in fattura' : 'Emessa (proforma)';
  return (
    <Badge
      color={proforma && converted ? 'stamp' : COLORS[status]}
      variant={status === 'draft' ? 'outline' : 'light'}
      radius="sm"
      tt="none"
      fw={500}
    >
      {label}
    </Badge>
  );
}
