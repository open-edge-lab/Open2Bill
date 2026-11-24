import { Alert, Button, Center, Group, Loader, Menu, Paper, Select, SegmentedControl, Stack, Table, Text, Title } from '@mantine/core';
import { IconChevronDown, IconPlus } from '@tabler/icons-react';
import { DOCUMENT_KIND_TITLES, sum, toDec, type DocumentKind } from '@open2bill/core';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { useAppInfo, useDocuments } from '../api/hooks';
import { StatusBadge } from '../components/StatusBadge';
import { euro, itDate } from '../lib/format';

type Filter = 'all' | 'invoices' | 'creditNotes' | 'proforma' | 'drafts';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tutti' },
  { value: 'invoices', label: 'Fatture' },
  { value: 'creditNotes', label: 'Note di credito' },
  { value: 'proforma', label: 'Proforma' },
  { value: 'drafts', label: 'Bozze' },
];

const NEW_ITEMS: { type: DocumentKind; label: string }[] = [
  { type: 'TD01', label: 'Fattura' },
  { type: 'proforma', label: 'Proforma' },
  { type: 'TD06', label: 'Parcella' },
  { type: 'TD04', label: 'Nota di credito' },
];

export function DocumentsPage() {
  const navigate = useNavigate();
  const app = useAppInfo();
  const docs = useDocuments();
  const [filter, setFilter] = useState<Filter>('all');
  const currentYear = String(new Date().getFullYear());

  const years = useMemo(() => {
    const set = new Set((docs.data ?? []).map((d) => d.date.slice(0, 4)));
    set.add(currentYear);
    return [...set].sort().reverse();
  }, [docs.data, currentYear]);
  const [year, setYear] = useState<string>(currentYear);

  const rows = useMemo(
    () =>
      (docs.data ?? []).filter((d) => {
        if (d.status !== 'draft' && !d.date.startsWith(year)) return false;
        switch (filter) {
          case 'invoices':
            return d.type === 'TD01' || d.type === 'TD06';
          case 'creditNotes':
            return d.type === 'TD04';
          case 'proforma':
            return d.type === 'proforma';
          case 'drafts':
            return d.status === 'draft';
          default:
            return true;
        }
      }),
    [docs.data, filter, year],
  );

  // Riepilogo dell'anno: fatture emesse meno note di credito
  const summary = useMemo(() => {
    const issued = (docs.data ?? []).filter((d) => d.status !== 'draft' && d.date.startsWith(year) && d.type !== 'proforma');
    const sign = (t: DocumentKind) => (t === 'TD04' ? -1 : 1);
    return {
      count: issued.filter((d) => d.type !== 'TD04').length,
      total: sum(issued.map((d) => toDec(d.documentTotal).times(sign(d.type)))),
      net: sum(issued.map((d) => toDec(d.netPayable).times(sign(d.type)))),
      toUpload: issued.filter((d) => d.status === 'issued').length,
    };
  }, [docs.data, year]);

  if (app.data && !app.data.hasIssuer) {
    return (
      <Alert color="ink" title="Benvenuto in Open2Bill" maw={640}>
        <Stack gap="sm">
          <Text size="sm">Per iniziare inserisci i tuoi dati di emittente: partita IVA, indirizzo, IBAN e i valori predefiniti.</Text>
          <Group>
            <Button onClick={() => navigate('/settings')}>Inserisci i dati dell’emittente</Button>
          </Group>
        </Stack>
      </Alert>
    );
  }

  return (
    <Stack maw={1280} mx="auto" gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={1}>Documenti</Title>
          {!docs.isPending && (
            <Text c="dimmed" size="sm">
              {summary.count === 0
                ? `Nessuna fattura emessa nel ${year}.`
                : `${summary.count} ${summary.count === 1 ? 'fattura emessa' : 'fatture emesse'} nel ${year}: ${euro(summary.total.toFixed(2))} fatturati, ${euro(summary.net.toFixed(2))} netti.`}
              {summary.toUpload > 0 && ` ${summary.toUpload} da caricare sul SdI.`}
            </Text>
          )}
        </div>
        <Menu position="bottom-end">
          <Menu.Target>
            <Button variant="default" rightSection={<IconChevronDown size={14} />} leftSection={<IconPlus size={16} />}>
              Nuovo documento
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {NEW_ITEMS.map((i) => (
              <Menu.Item key={i.type} onClick={() => navigate(`/documents/new?type=${i.type}`)}>
                {i.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Group>

      <Group justify="space-between">
        <SegmentedControl data={FILTERS} value={filter} onChange={(v) => setFilter(v as Filter)} />
        <Select data={years} value={year} onChange={(v) => v && setYear(v)} w={110} allowDeselect={false} aria-label="Anno" />
      </Group>

      {docs.error && <Alert color="red">{errorMessage(docs.error)}</Alert>}

      <Paper withBorder>
        {docs.isPending ? (
          <Center h={200}>
            <Loader />
          </Center>
        ) : rows.length === 0 ? (
          <Stack align="center" gap="sm" py={48}>
            <Text c="dimmed">Nessun documento con questi filtri.</Text>
            <Button variant="light" onClick={() => navigate('/documents/new')}>
              Crea una fattura
            </Button>
          </Stack>
        ) : (
          <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Numero</Table.Th>
                <Table.Th>Data</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Cliente</Table.Th>
                <Table.Th ta="right">Totale</Table.Th>
                <Table.Th ta="right">Netto</Table.Th>
                <Table.Th>Stato</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((d) => (
                <Table.Tr
                  key={d.id}
                  className="clickable-row"
                  onClick={() => navigate(`/documents/${d.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/documents/${d.id}`)}
                  tabIndex={0}
                >
                  <Table.Td fw={500}>{d.number ?? <Text span c="dimmed">—</Text>}</Table.Td>
                  <Table.Td>{itDate(d.date)}</Table.Td>
                  <Table.Td>{DOCUMENT_KIND_TITLES[d.type]}</Table.Td>
                  <Table.Td>{d.customerName || <Text span c="dimmed">Senza cliente</Text>}</Table.Td>
                  <Table.Td ta="right" className="amount">
                    {euro(d.documentTotal)}
                  </Table.Td>
                  <Table.Td ta="right" className="amount">
                    {euro(d.netPayable)}
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge status={d.status} proforma={d.type === 'proforma'} converted={Boolean(d.convertedToId)} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}
