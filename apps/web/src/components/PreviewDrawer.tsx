import { Alert, Box, Button, Center, Drawer, Group, Loader, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconRefresh } from '@tabler/icons-react';
import type { Document } from '@open2bill/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, apiUrl, errorMessage } from '../api/client';

// Anteprima del PDF: lo stesso HTML usato per generarlo, mostrato in un iframe isolato.

/** Tempo massimo per il PDF di prova: la prima volta il server deve avviare il browser. */
const PDF_TIMEOUT_MS = 90_000;

async function fetchPreviewPdf(document: Document): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl('/api/preview/pdf'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(document),
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(payload.message ?? `PDF non disponibile (errore ${res.status})`);
    }
    return await res.blob();
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('Il server non ha generato il PDF entro 90 secondi. Riprova; se continua, riavvia il server.');
    }
    if (err instanceof TypeError) throw new Error('Server non raggiungibile: il PDF non è stato generato.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(window.document.createElement('a'), { href: url, download: fileName });
  window.document.body.appendChild(a);
  a.click();
  a.remove();
  // revocato più tardi: alcuni browser leggono il blob dopo il click
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function PreviewDrawer({ opened, onClose, document }: { opened: boolean; onClose: () => void; document: Document }) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const preview = useQuery({
    queryKey: ['preview', JSON.stringify(document)],
    queryFn: () => api.post<string>('/api/preview/html', document),
    enabled: opened,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  async function downloadPdf() {
    setDownloadError(null);
    setDownloading(true);
    try {
      saveBlob(await fetchPreviewPdf(document), 'anteprima.pdf');
      notifications.show({ message: 'PDF di prova scaricato.', color: 'stamp' });
    } catch (err) {
      const message = errorMessage(err);
      setDownloadError(message);
      notifications.show({ title: 'PDF di prova non scaricato', message, color: 'red' });
    } finally {
      setDownloading(false);
    }
  }

  const error = preview.error ? errorMessage(preview.error) : downloadError;

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size={860} title="Anteprima del PDF" padding="md">
      <Group mb="sm" gap="xs">
        <Button
          variant="default"
          size="xs"
          leftSection={<IconRefresh size={14} />}
          onClick={() => void preview.refetch()}
          loading={preview.isFetching}
        >
          Aggiorna
        </Button>
        <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} onClick={downloadPdf} loading={downloading}>
          Scarica PDF di prova
        </Button>
        <Text size="xs" c="dimmed">
          Il file XML per l’Agenzia delle Entrate si genera quando emetti il documento.
        </Text>
      </Group>
      {error && (
        <Alert color="red" mb="sm">
          {error}
        </Alert>
      )}
      {preview.isPending && opened && (
        <Center h={300}>
          <Loader />
        </Center>
      )}
      {preview.data && (
        <Box
          component="iframe"
          title="Anteprima documento"
          srcDoc={preview.data}
          sandbox=""
          style={{ width: '100%', height: 'calc(100vh - 140px)', border: '1px solid var(--o2b-line)', background: '#e9ebee' }}
        />
      )}
    </Drawer>
  );
}
