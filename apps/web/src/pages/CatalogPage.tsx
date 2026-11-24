import { ActionIcon, Alert, Button, Center, Checkbox, Group, Loader, NumberInput, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { slugify, type Catalog, type CatalogItem } from '@open2bill/core';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import { keys, useCatalog } from '../api/hooks';

const KIND_OPTIONS = [
  { value: 'service', label: 'Prestazione' },
  { value: 'passThroughExpense', label: 'Spesa esclusa art. 15' },
];

function CatalogForm({ initial }: { initial: Catalog }) {
  const qc = useQueryClient();
  const form = useForm<Catalog>({ mode: 'controlled', initialValues: initial });
  const items = form.getValues().items;

  async function submit(values: Catalog) {
    // id leggibili e univoci derivati dalla descrizione
    const used = new Set<string>();
    const withIds = values.items.map((item) => {
      let id = item.id || slugify(item.description) || 'voce';
      for (let n = 2; used.has(id); n++) id = `${slugify(item.description) || 'voce'}-${n}`;
      used.add(id);
      return { ...item, id };
    });
    try {
      const saved = await api.put<Catalog>('/api/catalog', { items: withIds });
      form.setValues(saved);
      form.resetDirty(saved);
      await qc.invalidateQueries({ queryKey: keys.catalog });
      notifications.show({ message: 'Catalogo salvato.', color: 'stamp' });
    } catch (err) {
      notifications.show({ title: 'Catalogo non salvato', message: errorMessage(err), color: 'red' });
    }
  }

  const blank: CatalogItem = {
    id: '',
    kind: 'service',
    description: '',
    quantity: 1,
    unitPrice: 0,
    withholding: true,
    pensionFund: true,
  };

  return (
    <form onSubmit={form.onSubmit(submit)}>
      <Stack gap="sm">
        {items.length === 0 && (
          <Text c="dimmed" size="sm">
            Nessuna voce. Aggiungi le prestazioni che fatturi più spesso.
          </Text>
        )}
        {items.map((item, i) => (
          <Paper key={form.key(`items.${i}`)} withBorder p="sm">
            <Group align="flex-end" gap="sm" wrap="wrap">
              <TextInput label="Descrizione" style={{ flex: 1, minWidth: 240 }} required {...form.getInputProps(`items.${i}.description`)} />
              <Select label="Tipo" w={190} data={KIND_OPTIONS} allowDeselect={false} {...form.getInputProps(`items.${i}.kind`)} />
              <TextInput label="Unità" w={80} {...form.getInputProps(`items.${i}.unit`)} />
              <NumberInput label="Prezzo" w={120} leftSection="€" decimalScale={2} {...form.getInputProps(`items.${i}.unitPrice`)} />
              {item.kind === 'service' && (
                <NumberInput label="IVA %" w={80} decimalScale={2} placeholder="Predef." {...form.getInputProps(`items.${i}.vatRate`)} />
              )}
              <ActionIcon variant="subtle" color="red" mb={4} onClick={() => form.removeListItem('items', i)} aria-label="Elimina voce">
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
            {item.kind === 'service' && (
              <Group gap="lg" mt="xs">
                <Checkbox size="xs" label="Soggetta a ritenuta" {...form.getInputProps(`items.${i}.withholding`, { type: 'checkbox' })} />
                <Checkbox size="xs" label="Concorre al contributo cassa" {...form.getInputProps(`items.${i}.pensionFund`, { type: 'checkbox' })} />
              </Group>
            )}
          </Paper>
        ))}
        <Group justify="space-between">
          <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => form.insertListItem('items', blank)}>
            Aggiungi voce
          </Button>
          <Button type="submit" disabled={!form.isDirty()}>
            Salva catalogo
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function CatalogPage() {
  const catalog = useCatalog();
  return (
    <Stack maw={1000} mx="auto" gap="md">
      <div>
        <Title order={1}>Catalogo voci</Title>
        <Text c="dimmed" size="sm">
          Le voci ricorrenti si inseriscono nei documenti con “Dal catalogo”. Sono salvate in catalog.yaml.
        </Text>
      </div>
      {catalog.error && <Alert color="red">{errorMessage(catalog.error)}</Alert>}
      {catalog.isPending ? (
        <Center h={160}>
          <Loader />
        </Center>
      ) : (
        catalog.data && <CatalogForm initial={catalog.data} />
      )}
    </Stack>
  );
}
