import { Alert, Button, Center, Drawer, Group, Loader, Menu, Paper, Stack, Table, Text, TextInput, Title, ActionIcon } from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconDots, IconPlus, IconSearch } from '@tabler/icons-react';
import { displayName, emptyCustomer, type Customer, type CustomerData, type ValidationIssue } from '@open2bill/core';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, api, errorMessage } from '../api/client';
import { keys, useCustomers } from '../api/hooks';
import { CustomerFields } from '../components/CustomerFields';

type Editing = { id: string | null; data: CustomerData };

function CustomerForm({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<CustomerData>({ mode: 'controlled', initialValues: editing.data });
  const [busy, setBusy] = useState(false);

  async function submit(values: CustomerData) {
    setBusy(true);
    try {
      const res = editing.id
        ? await api.put<{ customer: Customer; issues: ValidationIssue[] }>(`/api/customers/${editing.id}`, values)
        : await api.post<{ customer: Customer; issues: ValidationIssue[] }>('/api/customers', values);
      await qc.invalidateQueries({ queryKey: keys.customers });
      const problems = res.issues.filter((i) => i.severity === 'error');
      notifications.show({
        message: problems.length
          ? `Salvato, ma da controllare: ${problems.map((p) => p.message).join('; ')}`
          : `${displayName(res.customer)} salvato.`,
        color: problems.length ? 'yellow' : 'stamp',
      });
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        form.setErrors(Object.fromEntries(err.issues.map((i) => [i.path.replace(/^customer\./, ''), i.message])));
      }
      notifications.show({ message: errorMessage(err), color: 'red' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={form.onSubmit(submit)}>
      <Stack>
        <CustomerFields form={form} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Annulla
          </Button>
          <Button type="submit" loading={busy}>
            Salva cliente
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function CustomersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const customers = useCustomers();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (customers.data ?? []).filter(
      (c) => !q || displayName(c).toLowerCase().includes(q) || (c.vatNumber ?? '').includes(q) || c.address.city.toLowerCase().includes(q),
    );
  }, [customers.data, query]);

  function remove(c: Customer) {
    modals.openConfirmModal({
      title: `Eliminare ${displayName(c)}?`,
      children: <Text size="sm">Il cliente sparisce dalla rubrica. I documenti già creati restano invariati.</Text>,
      labels: { confirm: 'Elimina', cancel: 'Annulla' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        await api.del(`/api/customers/${c.id}`);
        await qc.invalidateQueries({ queryKey: keys.customers });
      },
    });
  }

  return (
    <Stack maw={1100} mx="auto" gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={1}>Clienti</Title>
          <Text c="dimmed" size="sm">
            Ogni cliente è un file YAML nella cartella customers: puoi modificarlo anche a mano.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ id: null, data: emptyCustomer() })}>
          Nuovo cliente
        </Button>
      </Group>

      <TextInput
        placeholder="Cerca per nome, partita IVA o comune"
        leftSection={<IconSearch size={16} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        maw={420}
      />

      {customers.error && <Alert color="red">{errorMessage(customers.error)}</Alert>}

      <Paper withBorder>
        {customers.isPending ? (
          <Center h={160}>
            <Loader />
          </Center>
        ) : rows.length === 0 ? (
          <Text c="dimmed" ta="center" py={40}>
            {query ? 'Nessun cliente trovato.' : 'Rubrica vuota: aggiungi il primo cliente.'}
          </Text>
        ) : (
          <Table verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Cliente</Table.Th>
                <Table.Th>Partita IVA / CF</Table.Th>
                <Table.Th>Comune</Table.Th>
                <Table.Th>Recapito SdI</Table.Th>
                <Table.Th w={48} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((c) => {
                const { id, ...data } = c;
                return (
                  <Table.Tr key={id} className="clickable-row" onClick={() => setEditing({ id, data })}>
                    <Table.Td fw={500}>{displayName(c)}</Table.Td>
                    <Table.Td>{c.vatNumber ?? c.taxCode ?? '—'}</Table.Td>
                    <Table.Td>
                      {c.address.city}
                      {c.address.province ? ` (${c.address.province})` : ''}
                    </Table.Td>
                    <Table.Td>
                      <Text span className="code">
                        {c.recipientCode}
                      </Text>
                      {c.pec ? <Text span size="sm" c="dimmed">{` ${c.pec}`}</Text> : null}
                    </Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()}>
                      <Menu position="bottom-end">
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray" aria-label="Azioni">
                            <IconDots size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item onClick={() => navigate(`/documents/new?type=TD01&customerId=${id}`)}>Nuova fattura</Menu.Item>
                          <Menu.Item onClick={() => navigate(`/documents/new?type=proforma&customerId=${id}`)}>Nuova proforma</Menu.Item>
                          <Menu.Item color="red" onClick={() => remove(c)}>
                            Elimina
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <Drawer
        opened={editing !== null}
        onClose={() => setEditing(null)}
        position="right"
        size={560}
        title={editing?.id ? displayName(editing.data) : 'Nuovo cliente'}
      >
        {editing && <CustomerForm key={editing.id ?? 'new'} editing={editing} onClose={() => setEditing(null)} />}
      </Drawer>
    </Stack>
  );
}
