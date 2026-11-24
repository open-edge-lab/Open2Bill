import { Alert, Box, Button, Center, Drawer, Group, Loader } from '@mantine/core';
import { IconDownload, IconRefresh } from '@tabler/icons-react';
import type { Document } from '@open2bill/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../api/client';

// Anteprima del PDF: lo stesso HTML usato per generarlo, mostrato in un iframe isolato.

export function PreviewDrawer({ opened, onClose, document }: { opened: boolean; onClose: () => void; document: Document }) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
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
    const res = await fetch('/api/preview/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(document),
      credentials: 'same-origin',
    });
    if (!res.ok) {
      setDownloadError((await res.json().catch(() => ({}))).message ?? 'PDF non disponibile');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(window.document.createElement('a'), { href: url, download: 'anteprima.pdf' });
    a.click();
    URL.revokeObjectURL(url);
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
        <Button variant="default" size="xs" leftSection={<IconDownload size={14} />} onClick={downloadPdf}>
          Scarica PDF di prova
        </Button>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
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
