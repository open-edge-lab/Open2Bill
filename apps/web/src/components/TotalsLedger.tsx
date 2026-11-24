import { ActionIcon, Box, Group, NumberInput, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import {
  DOCUMENT_KIND_TITLES,
  PENSION_FUNDS,
  codeLabel,
  formatRate,
  toDec,
  type DocumentKind,
  type ReverseTarget,
  type Totals,
} from '@open2bill/core';
import { useState } from 'react';
import { euro } from '../lib/format';
import classes from './TotalsLedger.module.css';

// Il "partitario": la cascata dei totali nello stesso ordine del PDF.
// Gli importi segnati come obiettivo si possono cliccare e riscrivere:
// l'app ricava il prezzo della riga scelta (calcolo a ritroso).

interface Row {
  label: string;
  value: string;
  kind?: 'subtotal' | 'total' | 'net';
  target?: ReverseTarget;
}

function buildRows(totals: Totals, type: DocumentKind): Row[] {
  const rows: Row[] = [];
  const pf = totals.pensionFund;
  rows.push({ label: pf?.pricesIncludeContribution ? 'Imponibile (scorporato)' : 'Imponibile', value: totals.servicesTotal });
  if (pf) {
    const fund = pf.type === 'TC22' ? 'INPS' : codeLabel(PENSION_FUNDS, pf.type);
    rows.push({ label: pf.label || `Contributo ${fund} ${formatRate(pf.rate)}%`, value: pf.amount });
    rows.push({
      label: 'Totale imponibile',
      value: toDec(totals.servicesTotal).plus(pf.amount).toFixed(2),
      kind: 'subtotal',
      target: totals.passThroughTotal === '0.00' ? 'taxableTotal' : undefined,
    });
  }
  for (const r of totals.vatSummary) {
    if (!r.vatNature) rows.push({ label: `IVA ${formatRate(r.vatRate)}%`, value: r.vatAmount });
  }
  const stamp = totals.lines.find((l) => l.generated === 'stampDuty');
  const expenses = toDec(totals.passThroughTotal).minus(stamp ? stamp.total : 0);
  if (expenses.gt(0)) rows.push({ label: 'Spese escluse art. 15', value: expenses.toFixed(2) });
  if (stamp) rows.push({ label: 'Imposta di bollo', value: stamp.total });
  rows.push({
    label: type === 'TD01' ? 'Totale fattura' : `Totale ${DOCUMENT_KIND_TITLES[type].toLowerCase()}`,
    value: totals.documentTotal,
    kind: 'total',
    target: 'documentTotal',
  });
  if (totals.withholding) {
    rows.push({ label: `Ritenuta d’acconto ${formatRate(totals.withholding.rate)}%`, value: totals.withholding.amount });
    rows.push({ label: 'Netto da ricevere', value: totals.netPayable, kind: 'net', target: 'netPayable' });
  }
  if (!pf && totals.passThroughTotal === '0.00') rows[0]!.target = 'taxableTotal';
  return rows;
}

export interface TotalsLedgerProps {
  totals: Totals;
  type: DocumentKind;
  /** Se presente, gli importi obiettivo diventano modificabili. */
  onTarget?: (target: ReverseTarget, value: number) => void;
  /** Descrizione della riga che verrà ricalcolata (es. "riga 1"). */
  targetHint?: string;
}

export function TotalsLedger({ totals, type, onTarget, targetHint }: TotalsLedgerProps) {
  const rows = buildRows(totals, type);
  const pf = totals.pensionFund;
  const roundingGap = pf?.pricesIncludeContribution && pf.difference && pf.difference !== '0.00' ? pf.difference : null;
  const [editing, setEditing] = useState<ReverseTarget | null>(null);
  const [draft, setDraft] = useState<number | string>('');

  function confirm() {
    const value = typeof draft === 'number' ? draft : Number(String(draft).replace(',', '.'));
    if (editing && Number.isFinite(value) && value > 0) onTarget?.(editing, value);
    setEditing(null);
  }

  const ledger = (
    <Box className={classes.ledger}>
      <Stack gap={0}>
        {rows.map((row) => {
          const canEdit = Boolean(onTarget && row.target);
          const isEditing = editing !== null && editing === row.target;
          return (
            <Group
              key={row.label}
              className={classes.row}
              data-kind={row.kind}
              justify="space-between"
              wrap="nowrap"
              gap="sm"
            >
              <Text className={classes.label}>{row.label}</Text>
              {isEditing ? (
                <Group gap={4} wrap="nowrap">
                  <NumberInput
                    size="xs"
                    w={130}
                    autoFocus
                    value={draft}
                    onChange={setDraft}
                    decimalScale={2}
                    aria-label={`Valore desiderato per ${row.label}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirm();
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                  <ActionIcon variant="subtle" onClick={confirm} aria-label="Applica">
                    <IconCheck size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="gray" onClick={() => setEditing(null)} aria-label="Annulla">
                    <IconX size={16} />
                  </ActionIcon>
                </Group>
              ) : canEdit ? (
                <Tooltip label={`Scrivi l’importo che vuoi ottenere: ricalcolo ${targetHint ?? 'il compenso'}`}>
                  <UnstyledButton
                    className={`${classes.value} ${classes.editable} amount`}
                    onClick={() => {
                      setDraft(Number(row.value));
                      setEditing(row.target!);
                    }}
                  >
                    {euro(row.value)}
                  </UnstyledButton>
                </Tooltip>
              ) : (
                <Text className={`${classes.value} amount`}>{euro(row.value)}</Text>
              )}
            </Group>
          );
        })}
      </Stack>
    </Box>
  );
  if (!pf?.pricesIncludeContribution || !pf.grossTotal) return ledger;
  // Fuori dal riquadro: l'ultima riga (netto) ha lo sfondo pieno fino al bordo
  return (
    <Stack gap={4}>
      {ledger}
      <Text size="xs" c="dimmed">
        Righe con il contributo compreso: {euro(pf.grossTotal)}
        {roundingGap && ` (lo scorporo arrotondato differisce di ${euro(roundingGap)})`}
      </Text>
    </Stack>
  );
}
