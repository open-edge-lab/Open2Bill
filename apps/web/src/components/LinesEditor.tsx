import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Menu,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import { IconArrowDown, IconArrowUp, IconListDetails, IconPlus, IconReceipt, IconTrash } from '@tabler/icons-react';
import {
  VAT_NATURES,
  emptyLine,
  lineFromCatalog,
  passThroughExpenseLine,
  type CatalogItem,
  type ComputedLine,
  type Document,
  type Issuer,
} from '@open2bill/core';
import { euro } from '../lib/format';

const VAT_OPTIONS = ['22', '10', '5', '4', '0'].map((v) => ({ value: v, label: `${v}%` }));
const NATURE_OPTIONS = VAT_NATURES.filter((n) => n.code !== 'N1').map((n) => ({
  value: n.code,
  label: `${n.code} - ${n.label}`,
}));

interface Props {
  form: UseFormReturnType<Document>;
  issuer: Issuer;
  catalog: CatalogItem[];
  computed: ComputedLine[];
  hasWithholding: boolean;
  hasPensionFund: boolean;
  onFocusLine?: (index: number) => void;
  activeLine?: number;
}

export function LinesEditor({ form, issuer, catalog, computed, hasWithholding, hasPensionFund, onFocusLine, activeLine }: Props) {
  const lines = form.getValues().lines;

  return (
    <Stack gap="sm">
      {lines.map((line, i) => {
        const isExpense = line.kind === 'passThroughExpense';
        const computedLine = computed.find((c) => c.index === i);
        const total = computedLine?.grossTotal ?? computedLine?.total;
        const netTotal = computedLine?.grossTotal ? computedLine.total : undefined;
        const showNature = !isExpense && Number(line.vatRate) === 0;
        return (
          <Paper
            key={form.key(`lines.${i}`)}
            withBorder
            p="sm"
            onFocusCapture={() => !isExpense && onFocusLine?.(i)}
            style={activeLine === i && !isExpense ? { borderColor: 'var(--mantine-color-ink-3)' } : undefined}
          >
            <Stack gap="xs">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Group gap={6}>
                  <Text size="sm" fw={500}>
                    Riga {i + 1}
                  </Text>
                  {isExpense && (
                    <Badge size="sm" variant="light" color="gray" tt="none">
                      Spesa esclusa art. 15 (N1)
                    </Badge>
                  )}
                </Group>
                <Group gap={2}>
                  <Tooltip label="Sposta su">
                    <ActionIcon variant="subtle" color="gray" disabled={i === 0} onClick={() => form.reorderListItem('lines', { from: i, to: i - 1 })} aria-label="Sposta su">
                      <IconArrowUp size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Sposta giù">
                    <ActionIcon variant="subtle" color="gray" disabled={i === lines.length - 1} onClick={() => form.reorderListItem('lines', { from: i, to: i + 1 })} aria-label="Sposta giù">
                      <IconArrowDown size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Elimina riga">
                    <ActionIcon variant="subtle" color="red" disabled={lines.length === 1} onClick={() => form.removeListItem('lines', i)} aria-label="Elimina riga">
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>

              <Textarea
                aria-label="Descrizione"
                placeholder="Descrizione della prestazione"
                autosize
                minRows={1}
                maxRows={6}
                {...form.getInputProps(`lines.${i}.description`)}
                key={form.key(`lines.${i}.description`)}
              />

              <Group gap="sm" align="flex-end" wrap="wrap">
                <NumberInput label="Quantità" w={90} min={0} decimalScale={4} {...form.getInputProps(`lines.${i}.quantity`)} key={form.key(`lines.${i}.quantity`)} />
                <TextInput label="Unità" w={80} placeholder="ore" {...form.getInputProps(`lines.${i}.unit`)} key={form.key(`lines.${i}.unit`)} />
                <NumberInput
                  label="Prezzo"
                  w={130}
                  leftSection="€"
                  decimalScale={2}
                  {...form.getInputProps(`lines.${i}.unitPrice`)}
                  key={form.key(`lines.${i}.unitPrice`)}
                />
                {!isExpense && (
                  <>
                    <NumberInput label="Sconto %" w={90} min={0} max={100} decimalScale={2} {...form.getInputProps(`lines.${i}.discountPercent`)} key={form.key(`lines.${i}.discountPercent`)} />
                    <Select
                      label="IVA"
                      w={90}
                      data={VAT_OPTIONS}
                      allowDeselect={false}
                      value={String(line.vatRate)}
                      onChange={(v) => {
                        form.setFieldValue(`lines.${i}.vatRate`, Number(v));
                        if (Number(v) > 0) form.setFieldValue(`lines.${i}.vatNature`, undefined);
                      }}
                      key={form.key(`lines.${i}.vatRate`)}
                    />
                  </>
                )}
                <Stack gap={0} ml="auto" align="flex-end">
                  <Text size="xs" c="dimmed">
                    {netTotal ? 'Importo, contributo compreso' : 'Importo'}
                  </Text>
                  <Text fw={500} className="amount">
                    {euro(total)}
                  </Text>
                  {netTotal && (
                    <Text size="xs" c="dimmed" className="amount">
                      netto {euro(netTotal)}
                    </Text>
                  )}
                </Stack>
              </Group>

              {showNature && (
                <Select
                  label="Natura dell’operazione (IVA 0%)"
                  placeholder="Scegli la natura"
                  data={NATURE_OPTIONS}
                  searchable
                  {...form.getInputProps(`lines.${i}.vatNature`)}
                  key={form.key(`lines.${i}.vatNature`)}
                />
              )}

              {!isExpense && (hasWithholding || hasPensionFund) && (
                <Group gap="lg">
                  {hasWithholding && (
                    <Checkbox
                      size="xs"
                      label="Soggetta a ritenuta"
                      {...form.getInputProps(`lines.${i}.withholding`, { type: 'checkbox' })}
                      key={form.key(`lines.${i}.withholding`)}
                    />
                  )}
                  {hasPensionFund && (
                    <Checkbox
                      size="xs"
                      label="Concorre al contributo cassa"
                      {...form.getInputProps(`lines.${i}.pensionFund`, { type: 'checkbox' })}
                      key={form.key(`lines.${i}.pensionFund`)}
                    />
                  )}
                </Group>
              )}
            </Stack>
          </Paper>
        );
      })}

      <Group gap="xs">
        <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => form.insertListItem('lines', emptyLine(issuer))}>
          Aggiungi riga
        </Button>
        <Menu position="bottom-start" withinPortal>
          <Menu.Target>
            <Button variant="default" leftSection={<IconListDetails size={16} />} disabled={catalog.length === 0}>
              Dal catalogo
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {catalog.map((item) => (
              <Menu.Item key={item.id} onClick={() => form.insertListItem('lines', lineFromCatalog(item, issuer))}>
                {item.description}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
        <Button variant="default" leftSection={<IconReceipt size={16} />} onClick={() => form.insertListItem('lines', passThroughExpenseLine())}>
          Spesa anticipata (art. 15)
        </Button>
      </Group>
    </Stack>
  );
}
