import { Alert, Center, Loader } from '@mantine/core';
import { DOCUMENT_KINDS, type DocumentKind } from '@open2bill/core';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';
import { api, errorMessage } from '../api/client';
import { useDocument } from '../api/hooks';
import type { Document } from '@open2bill/core';
import { DocumentEditor } from './DocumentEditor';
import { DocumentView } from './DocumentView';

// Route /documents/new e /documents/:id: le bozze si aprono nell'editor,
// i documenti emessi nella vista in sola lettura.

export function DocumentPage() {
  const { id } = useParams();
  const [params] = useSearchParams();

  const typeParam = params.get('type');
  const type: DocumentKind = DOCUMENT_KINDS.includes(typeParam as DocumentKind) ? (typeParam as DocumentKind) : 'TD01';
  const customerId = params.get('customerId') ?? undefined;

  const existing = useDocument(id);
  const template = useQuery({
    queryKey: ['document-template', type, customerId ?? ''],
    queryFn: () =>
      api.get<Document>(`/api/documents/new?type=${type}${customerId ? `&customerId=${encodeURIComponent(customerId)}` : ''}`),
    enabled: !id,
    staleTime: Infinity,
    gcTime: 0,
  });

  const query = id ? existing : template;
  if (query.isPending) {
    return (
      <Center h={300}>
        <Loader />
      </Center>
    );
  }
  // Solo se non c'è niente da mostrare: se fallisce un ricaricamento (es. al ritorno sulla
  // finestra, con il server irraggiungibile) l'editor resta aperto con le modifiche in corso.
  if (query.error && !query.data) {
    return (
      <Alert color="red" title="Documento non disponibile">
        {errorMessage(query.error)}
      </Alert>
    );
  }

  if (id && existing.data) {
    const { document } = existing.data;
    if (document.status === 'draft') return <DocumentEditor key={document.id} initial={document} isNew={false} />;
    return <DocumentView details={existing.data} />;
  }
  return <DocumentEditor key={template.data!.id} initial={template.data!} isNew />;
}
