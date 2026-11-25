import {
  Alert,
  Anchor,
  Box,
  Button,
  Grid,
  Group,
  List,
  Paper,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
  IconCopy,
  IconDownload,
  IconFileInvoice,
  IconFolderOpen,
  IconReceiptRefund,
  IconRefresh,
  IconUpload,
} from '@tabler/icons-react';
import { DOCUMENT_KIND_TITLES, displayName, todayIso, type Document } from '@open2bill/core';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, apiUrl, errorMessage } from '../api/client';
import { useAppInfo, useDocumentAction, useInvalidateDocuments } from '../api/hooks';
import type { DocumentDetails } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { TotalsLedger } from '../components/TotalsLedger';
import { desktop } from '../lib/desktop';
import { itDate } from '../lib/format';

// Documento emesso: sola lettura, download dei file e azioni successive.

function UploadModal({ doc, onDone }: { doc: Document; onDone: () => void }) {
  const [date, setDate] = useState<string | null>(todayIso());
  const [notes, setNotes] = useState(doc.sdiNotes ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Stack>
      <DateInput label="Data di caricamento" valueFormat="DD/MM/YYYY" value={date} onChange={setDate} />
      <Textarea label="Note (es. identificativo SdI, esito)" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} autosize minRows={2} />
      <Group justify="flex-end">
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post(`/api/documents/${doc.id}/status`, { status: 'uploaded', uploadedAt: date ?? undefined, sdiNotes: notes });
              onDone();
              modals.closeAll();
            } catch (err) {
              notifications.show({ message: errorMessage(err), color: 'red' });
            } finally {
              setBusy(false);
            }
          }}
        >
          Segna come caricata
        </Button>
      </Group>
    </Stack>
  );
}

export function DocumentView({ details }: { details: DocumentDetails }) {
  const { document: doc, totals } = details;
  const navigate = useNavigate();
  const app = useAppInfo();
  const invalidate = useInvalidateDocuments();
  const convert = useDocumentAction('convert');
  const creditNote = useDocumentAction('credit-note');
  const duplicate = useDocumentAction('duplicate');
  const regenerate = useDocumentAction('regenerate-pdf');
  const [html, setHtml] = useState<string | null>(null);

  const title = DOCUMENT_KIND_TITLES[doc.type];
  const isProforma = doc.type === 'proforma';
  const year = doc.date.slice(0, 4);

  useEffect(() => {
    api
      .post<string>('/api/preview/html', doc)
      .then(setHtml)
      .catch(() => setHtml(null));
  }, [doc]);

  async function run(action: ReturnType<typeof useDocumentAction>, success: string, open = true) {
    try {
      const res = (await action.mutateAsync(doc.id)) as Document;
      notifications.show({ message: success, color: 'stamp' });
      if (open) navigate(`/documents/${res.id}`);
    } catch (err) {
      notifications.show({ message: errorMessage(err), color: 'red' });
    }
  }

  async function backToIssued() {
    await api.post(`/api/documents/${doc.id}/status`, { status: 'issued' });
    await invalidate();
  }

  const fileLink = (kind: 'xml' | 'pdf', fileName?: string) =>
    fileName ? (
      <Button component="a" href={apiUrl(`/api/documents/${doc.id}/${kind}`)} variant={kind === 'xml' ? 'filled' : 'default'} leftSection={<IconDownload size={16} />}>
        Scarica {kind.toUpperCase()}
      </Button>
    ) : null;

  return (
    <Box maw={1280} mx="auto">
      <Group justify="space-between" align="flex-end" mb="md">
        <div>
          <Group gap="sm">
            <Title order={1}>
              {title} n. {doc.number} del {itDate(doc.date)}
            </Title>
            <StatusBadge status={doc.status} proforma={isProforma} converted={Boolean(doc.convertedToId)} />
          </Group>
          <Text c="dimmed" size="sm">
            {displayName(doc.customer)}
            {doc.linkedInvoice ? `, storno della fattura n. ${doc.linkedInvoice.number} del ${itDate(doc.linkedInvoice.date)}` : ''}
            {doc.sourceProformaId ? ', da proforma' : ''}
          </Text>
        </div>
        <Group gap="xs">
          {fileLink('xml', doc.xmlFileName)}
          {fileLink('pdf', doc.pdfFileName)}
          {desktop && doc.xmlFileName && (
            <Button variant="default" leftSection={<IconFolderOpen size={16} />} onClick={() => desktop?.revealOutput(`${year}/${doc.xmlFileName}`)}>
              Mostra nella cartella
            </Button>
          )}
        </Group>
      </Group>

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 8 }}>
          {html ? (
            <Box
              component="iframe"
              title={`${title} ${doc.number}`}
              srcDoc={html}
              sandbox=""
              style={{ width: '100%', height: 'calc(100vh - 170px)', minHeight: 600, border: '1px solid var(--o2b-line)', background: '#e9ebee' }}
            />
          ) : (
            <Paper withBorder p="xl">
              <Text c="dimmed">Anteprima non disponibile.</Text>
            </Paper>
          )}
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack gap="md">
            <TotalsLedger totals={totals} type={doc.type} />

            {!isProforma && doc.status === 'issued' && (
              <Paper withBorder p="md">
                <Stack gap="xs">
                  <Title order={3}>Carica su Fatture e Corrispettivi</Title>
                  <List size="sm" spacing={4} type="ordered">
                    <List.Item>Scarica il file XML {doc.xmlFileName && <Text span className="code">{doc.xmlFileName}</Text>}.</List.Item>
                    <List.Item>
                      Accedi al portale{' '}
                      <Anchor href="https://ivaservizi.agenziaentrate.gov.it/portale/" target="_blank" rel="noreferrer">
                        Fatture e Corrispettivi
                      </Anchor>
                      , sezione Fatturazione elettronica, e trasmetti il file.
                    </List.Item>
                    <List.Item>Quando il SdI lo accetta, segnalo qui.</List.Item>
                  </List>
                  <Button
                    variant="light"
                    color="stamp"
                    leftSection={<IconUpload size={16} />}
                    onClick={() =>
                      modals.open({
                        title: 'Fattura caricata sul SdI',
                        children: <UploadModal doc={doc} onDone={() => void invalidate()} />,
                      })
                    }
                  >
                    Segna come caricata
                  </Button>
                </Stack>
              </Paper>
            )}

            {doc.status === 'uploaded' && (
              <Alert color="stamp" title={`Caricata il ${itDate(doc.uploadedAt)}`}>
                {doc.sdiNotes && <Text size="sm">{doc.sdiNotes}</Text>}
                <Anchor component="button" size="sm" onClick={backToIssued}>
                  Annulla stato di caricamento
                </Anchor>
              </Alert>
            )}

            <Paper withBorder p="md">
              <Stack gap="xs">
                <Title order={3}>Azioni</Title>
                {isProforma &&
                  (doc.convertedToId ? (
                    <Button component={Link} to={`/documents/${doc.convertedToId}`} variant="default" leftSection={<IconFileInvoice size={16} />}>
                      Apri la fattura generata
                    </Button>
                  ) : (
                    <Button leftSection={<IconFileInvoice size={16} />} loading={convert.isPending} onClick={() => run(convert, 'Bozza di fattura creata dalla proforma.')}>
                      Converti in fattura
                    </Button>
                  ))}
                {(doc.type === 'TD01' || doc.type === 'TD06') && (
                  <Button
                    variant="default"
                    leftSection={<IconReceiptRefund size={16} />}
                    loading={creditNote.isPending}
                    onClick={() => run(creditNote, 'Bozza di nota di credito creata.')}
                  >
                    Crea nota di credito
                  </Button>
                )}
                <Button variant="default" leftSection={<IconCopy size={16} />} loading={duplicate.isPending} onClick={() => run(duplicate, 'Copia creata come bozza.')}>
                  Duplica come nuova bozza
                </Button>
                {app.data?.pdfAvailable && (
                  <Button
                    variant="subtle"
                    leftSection={<IconRefresh size={16} />}
                    loading={regenerate.isPending}
                    onClick={() => run(regenerate, 'PDF rigenerato con il template attuale.', false)}
                  >
                    Rigenera PDF
                  </Button>
                )}
              </Stack>
            </Paper>
          </Stack>
        </Grid.Col>
      </Grid>
    </Box>
  );
}
