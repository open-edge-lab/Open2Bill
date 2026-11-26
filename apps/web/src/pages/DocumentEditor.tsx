import {
  Alert,
  Anchor,
  Box,
  Button,
  Checkbox,
  Grid,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconDeviceFloppy, IconEye, IconFileCheck, IconTrash, IconUserPlus } from '@tabler/icons-react';
import {
  DOCUMENT_KIND_TITLES,
  DocumentSchema,
  PAYMENT_METHODS,
  PAYMENT_REASONS,
  PAYMENT_TERMS,
  PENSION_FUNDS,
  VAT_NATURES,
  WITHHOLDING_TYPES,
  addDays,
  calculateTotals,
  displayName,
  documentNumberFor,
  reverseCalculation,
  reverseCalculationAll,
  sameBankDetails,
  seriesFor,
  validateDocument,
  withBankDetails,
  type Customer,
  type Document,
  type DocumentKind,
  type ReverseTarget,
  type Totals,
  type ValidationIssue,
} from '@open2bill/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { ApiError, api, errorMessage } from '../api/client';
import {
  keys,
  useCatalog,
  useCustomers,
  useDocuments,
  useForgetDraft,
  useInvalidateDocuments,
  useIssueDocument,
  useIssuer,
  useNumbering,
} from '../api/hooks';
import type { DocumentDetails } from '../api/types';
import { CustomerFields, customerFormValues } from '../components/CustomerFields';
import { IssuesList } from '../components/IssuesList';
import { LinesEditor } from '../components/LinesEditor';
import { PreviewDrawer } from '../components/PreviewDrawer';
import { TotalsLedger } from '../components/TotalsLedger';
import { itDate } from '../lib/format';

const TYPE_OPTIONS: { value: DocumentKind; label: string }[] = [
  { value: 'TD01', label: 'Fattura' },
  { value: 'TD06', label: 'Parcella' },
  { value: 'TD04', label: 'Nota di credito' },
  { value: 'proforma', label: 'Proforma' },
];

const codeOptions = (list: { code: string; label: string }[]) => list.map((e) => ({ value: e.code, label: `${e.code} - ${e.label}` }));

function safeTotals(values: Document): Totals | null {
  try {
    return calculateTotals(values);
  } catch {
    return null;
  }
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Title order={3}>{title}</Title>
        {aside}
      </Group>
      {children}
    </Paper>
  );
}

export function DocumentEditor({ initial, isNew }: { initial: Document; isNew: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidateDocuments();
  const issuerQ = useIssuer();
  const customersQ = useCustomers();
  const catalogQ = useCatalog();
  const documentsQ = useDocuments();
  const issueMutation = useIssueDocument();
  const forgetDraft = useForgetDraft();
  const [preview, previewHandlers] = useDisclosure(false);
  const [activeLine, setActiveLine] = useState(0);
  // Calcolo a ritroso: su tutte le prestazioni in proporzione oppure solo sulla riga scelta
  const [reverseScope, setReverseScope] = useState<'all' | 'line'>('all');
  const [serverIssues, setServerIssues] = useState<ValidationIssue[]>([]);
  const [saving, setSaving] = useState(false);
  const skipBlocker = useRef(false);
  // la bozza esiste già sul server (dopo il primo salvataggio di un documento nuovo)
  const persisted = useRef(!isNew);

  const form = useForm<Document>({
    mode: 'controlled',
    initialValues: { ...initial, customer: customerFormValues(initial.customer) },
  });
  const values = form.getValues();
  const issuer = issuerQ.data?.issuer;
  const type = values.type;
  const totals = useMemo(() => safeTotals(values), [values]);

  // Validazione immediata (stesse regole del server)
  const clientIssues = useMemo<ValidationIssue[]>(() => {
    if (!issuer) return [];
    const parsed = DocumentSchema.safeParse(values);
    if (!parsed.success) {
      return parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, severity: 'error' as const }));
    }
    return validateDocument(parsed.data, issuer).issues;
  }, [values, issuer]);

  const issues = serverIssues.length ? serverIssues : clientIssues;
  const hasErrors = issues.some((i) => i.severity === 'error');
  // Con un cliente scelto dalla rubrica mostro solo un riepilogo, salvo errori nei suoi dati.
  const [customerExpanded, setCustomerExpanded] = useState(false);
  const customerHasErrors = issues.some((i) => i.severity === 'error' && i.path.startsWith('customer.'));

  // Avviso per modifiche non salvate quando si cambia pagina
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !skipBlocker.current && form.isDirty() && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    modals.openConfirmModal({
      title: 'Modifiche non salvate',
      children: <Text size="sm">Se esci ora perdi le modifiche a questo documento.</Text>,
      labels: { confirm: 'Esci senza salvare', cancel: 'Resta qui' },
      confirmProps: { color: 'red' },
      onConfirm: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
  }, [blocker]);

  // Numero: quello scelto nella bozza (anche di un documento riaperto) oppure il prossimo della
  // numerazione salvata, che cresce a ogni emissione.
  const year = Number(values.date.slice(0, 4));
  const numberingQ = useNumbering(year);
  const proposedSequence = numberingQ.data?.series[seriesFor(type)].next;
  const sequence = values.sequence ?? proposedSequence;
  const formattedNumber = issuer && sequence ? documentNumberFor(issuer, type, sequence, year) : null;
  // Numeri già usati nell'anno e nella serie, dagli id dei documenti emessi ("2026-invoice-0016").
  const usedSequences = useMemo(() => {
    const series = seriesFor(type);
    const word = series === 'creditNote' ? 'credit-note' : series;
    const pattern = new RegExp(`^${year}-${word}-(\\d+)$`);
    return new Set((documentsQ.data ?? []).map((d) => pattern.exec(d.id)).filter((m) => m !== null).map((m) => Number(m[1])));
  }, [documentsQ.data, type, year]);
  const sequenceTaken = values.sequence !== undefined && usedSequences.has(values.sequence);
  function setSequence(value: string | number) {
    const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
    form.setFieldValue('sequence', Number.isInteger(n) && n > 0 && n !== proposedSequence ? n : undefined);
  }
  const sequenceHint = (() => {
    if (!proposedSequence || !sequence) return undefined;
    const full = formattedNumber && formattedNumber !== String(sequence) ? `Numero completo: ${formattedNumber}. ` : '';
    if (values.sequence === undefined) return `${full}È il prossimo della numerazione.`;
    if (sequence > proposedSequence) return `${full}Salta i numeri da ${proposedSequence} a ${sequence - 1}.`;
    return sequenceTaken ? full || undefined : `${full}Numero libero, più basso del prossimo (${proposedSequence}).`;
  })();

  const customers = customersQ.data ?? [];
  const issuedInvoices = (documentsQ.data ?? []).filter((d) => (d.type === 'TD01' || d.type === 'TD06') && d.status !== 'draft');

  function pickCustomer(id: string | null) {
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    const { id: customerId, ...data } = c as Customer;
    form.setFieldValue('customerId', customerId);
    // tutti i dati del cliente, anche quelli vuoti: nessun campo resta con il testo di prima
    form.setFieldValue('customer', customerFormValues(data));
    setCustomerExpanded(false);
    if (data.kind === 'individual' && form.getValues().withholding) {
      form.setFieldValue('withholding', null);
      notifications.show({ message: 'Cliente privato: ritenuta d’acconto tolta.', color: 'gray' });
    }
  }

  async function saveCustomerToBook() {
    try {
      const res = await api.post<{ customer: Customer }>('/api/customers', form.getValues().customer);
      form.setFieldValue('customerId', res.customer.id);
      await qc.invalidateQueries({ queryKey: keys.customers });
      notifications.show({ message: `${displayName(res.customer)} salvato in rubrica.`, color: 'stamp' });
    } catch (err) {
      notifications.show({ title: 'Cliente non salvato', message: errorMessage(err), color: 'red' });
    }
  }

  function applyIssuesToFields(list: ValidationIssue[]) {
    const errors: Record<string, string> = {};
    for (const i of list) if (i.severity === 'error' && !errors[i.path]) errors[i.path] = i.message;
    form.setErrors(errors);
  }

  async function saveDraft() {
    if (await save()) notifications.show({ message: 'Bozza salvata.', color: 'stamp' });
  }

  async function save({ redirect = true }: { redirect?: boolean } = {}): Promise<Document | null> {
    setSaving(true);
    setServerIssues([]);
    try {
      const body = form.getValues();
      const res = persisted.current
        ? await api.put<DocumentDetails>(`/api/documents/${body.id}`, body)
        : await api.post<DocumentDetails>('/api/documents', body);
      persisted.current = true;
      form.setValues(res.document);
      form.resetDirty(res.document);
      await invalidate();
      if (isNew && redirect) {
        skipBlocker.current = true;
        navigate(`/documents/${res.document.id}`, { replace: true });
      }
      return res.document;
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        setServerIssues(err.issues);
        applyIssuesToFields(err.issues);
      }
      notifications.show({ title: 'Bozza non salvata', message: errorMessage(err), color: 'red' });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function issue() {
    const saved = await save({ redirect: false });
    if (!saved) return;
    try {
      const res = await issueMutation.mutateAsync(saved.id);
      const title = DOCUMENT_KIND_TITLES[res.document.type];
      notifications.show({
        title: `${title} n. ${res.document.number} emessa`,
        message:
          res.document.type === 'proforma'
            ? 'PDF pronto.'
            : `XML ${res.document.xmlFileName} pronto da caricare su Fatture e Corrispettivi.`,
        color: 'stamp',
      });
      for (const w of res.warnings) notifications.show({ message: w, color: 'yellow' });
      skipBlocker.current = true;
      navigate(`/documents/${res.document.id}`, { replace: true });
      void forgetDraft(saved.id);
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        setServerIssues(err.issues);
        applyIssuesToFields(err.issues);
      }
      notifications.show({ title: 'Documento non emesso', message: errorMessage(err), color: 'red' });
    }
  }

  function confirmIssue() {
    const title = DOCUMENT_KIND_TITLES[type].toLowerCase();
    modals.openConfirmModal({
      title: `Emettere la ${title}?`,
      children: (
        <Text size="sm">
          Riceverà il numero <b>{formattedNumber ?? 'successivo'}</b>.
          {type !== 'proforma' && ' Verranno generati il file XML per l’Agenzia delle Entrate e il PDF.'}
        </Text>
      ),
      labels: { confirm: 'Emetti', cancel: 'Annulla' },
      onConfirm: () => void issue(),
    });
  }

  function confirmDelete() {
    modals.openConfirmModal({
      title: 'Eliminare la bozza?',
      children: <Text size="sm">La bozza verrà cancellata definitivamente.</Text>,
      labels: { confirm: 'Elimina', cancel: 'Annulla' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        await api.del(`/api/documents/${values.id}`);
        skipBlocker.current = true;
        navigate('/');
        void forgetDraft(values.id);
      },
    });
  }

  function onTarget(target: ReverseTarget, value: number) {
    const lines = form.getValues().lines;
    const idx = lines[activeLine]?.kind === 'service' ? activeLine : lines.findIndex((l) => l.kind === 'service');
    if (idx < 0) return;
    try {
      let r: { exact: boolean; achieved: string };
      if (reverseScope === 'all' && serviceLineCount > 1) {
        const all = reverseCalculationAll(form.getValues(), target, value);
        for (const [i, price] of Object.entries(all.unitPrices)) form.setFieldValue(`lines.${i}.unitPrice`, Number(price));
        r = all;
      } else {
        const single = reverseCalculation(form.getValues(), idx, target, value);
        form.setFieldValue(`lines.${idx}.unitPrice`, Number(single.unitPrice));
        r = single;
      }
      if (!r.exact) {
        notifications.show({
          message: `Al centesimo non si arriva esattamente: il valore più vicino è ${r.achieved.replace('.', ',')} €.`,
          color: 'yellow',
        });
      }
    } catch (err) {
      notifications.show({ message: errorMessage(err), color: 'red' });
    }
  }

  function toggle<K extends 'pensionFund' | 'withholding' | 'stampDuty' | 'payment'>(key: K, on: boolean) {
    if (!issuer) return;
    if (!on) return form.setFieldValue(key, null as never);
    const v = form.getValues();
    const defaults: Record<string, unknown> = {
      pensionFund: issuer.defaults.pensionFund ?? {
        type: 'TC22',
        rate: 4,
        vatRate: issuer.defaults.vatRate,
        withholding: true,
        pricesIncludeContribution: false,
      },
      withholding: issuer.defaults.withholding ?? { type: 'RT01', rate: 20, paymentReason: 'A' },
      stampDuty: issuer.defaults.stampDuty,
      payment: { ...issuer.payment, dueDate: addDays(v.date, issuer.payment.dueDays) },
    };
    form.setFieldValue(key, defaults[key] as never);
  }

  // Banca diversa da quella delle Impostazioni: bozza creata prima di un cambio con una banca
  // scelta a mano, documento duplicato, oppure editor aperto da prima del cambio.
  const issuerBank = issuer?.payment;
  const bankDiffers = Boolean(
    values.payment && issuerBank && (issuerBank.iban || issuerBank.bankName) && !sameBankDetails(values.payment, issuerBank),
  );
  const issuerBankLabel = [issuerBank?.bankName, issuerBank?.iban && `IBAN ${issuerBank.iban}`].filter(Boolean).join(', ');
  function applyIssuerBank() {
    const payment = form.getValues().payment;
    if (!payment || !issuerBank) return;
    form.setFieldValue(
      'payment',
      withBankDetails(payment, {
        bankName: issuerBank.bankName ?? '',
        iban: issuerBank.iban ?? '',
        beneficiary: issuerBank.beneficiary ?? '',
      }),
    );
  }

  if (issuerQ.error) {
    return (
      <Alert color="yellow" title="Mancano i dati dell’emittente">
        Configura i tuoi dati in Impostazioni prima di creare documenti. {errorMessage(issuerQ.error)}
      </Alert>
    );
  }

  const title = isNew ? `Nuova ${DOCUMENT_KIND_TITLES[type].toLowerCase()}` : `Bozza: ${DOCUMENT_KIND_TITLES[type].toLowerCase()}`;
  const serviceLineCount = values.lines.filter((l) => l.kind === 'service').length;
  const reverseOnAll = reverseScope === 'all' && serviceLineCount > 1;
  const activeLineNumber = (values.lines[activeLine]?.kind === 'service' ? activeLine : Math.max(0, values.lines.findIndex((l) => l.kind === 'service'))) + 1;
  const activeLineLabel = reverseOnAll ? 'i prezzi di tutte le prestazioni, in proporzione' : `il prezzo della riga ${activeLineNumber}`;

  return (
    <Box maw={1280} mx="auto">
      <Group justify="space-between" mb="md" align="flex-end">
        <div>
          <Title order={1}>{title}</Title>
          <Text c="dimmed" size="sm">
            Numero {formattedNumber ? `${formattedNumber} (assegnato all’emissione)` : 'assegnato all’emissione'}
          </Text>
        </div>
        <SegmentedControl
          data={TYPE_OPTIONS}
          {...form.getInputProps('type')}
          onChange={(value) => {
            // un numero scelto vale per la serie di prima: con il tipo si torna al prossimo
            form.setFieldValue('type', value as DocumentKind);
            form.setFieldValue('sequence', undefined);
          }}
        />
      </Group>

      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack gap="md">
            <Section title="Documento">
              <Group grow align="flex-start">
                <NumberInput
                  label="Numero"
                  min={1}
                  allowDecimal={false}
                  allowNegative={false}
                  value={sequence ?? ''}
                  onChange={setSequence}
                  description={
                    <>
                      {sequenceHint}
                      {values.sequence !== undefined && proposedSequence && (
                        <>
                          {' '}
                          <Anchor component="button" type="button" size="xs" onClick={() => form.setFieldValue('sequence', undefined)}>
                            Usa il prossimo ({proposedSequence})
                          </Anchor>
                        </>
                      )}
                    </>
                  }
                  error={sequenceTaken ? `Il numero ${formattedNumber} del ${year} è già usato` : undefined}
                />
                <DateInput
                  label="Data"
                  valueFormat="DD/MM/YYYY"
                  required
                  {...form.getInputProps('date')}
                  onChange={(v) => {
                    if (!v) return;
                    form.setFieldValue('date', v);
                    const p = form.getValues().payment;
                    if (p && issuer) form.setFieldValue('payment.dueDate', addDays(v, p.dueDays));
                  }}
                />
                {type === 'TD04' && (
                  <Select
                    label="Fattura da stornare"
                    placeholder="Scegli la fattura"
                    data={issuedInvoices.map((d) => ({ value: d.id, label: `n. ${d.number} del ${itDate(d.date)} (${d.customerName})` }))}
                    value={issuedInvoices.find((d) => d.number === values.linkedInvoice?.number && d.date === values.linkedInvoice?.date)?.id ?? null}
                    onChange={(id) => {
                      const d = issuedInvoices.find((x) => x.id === id);
                      if (d?.number) form.setFieldValue('linkedInvoice', { number: d.number, date: d.date });
                    }}
                    error={form.errors.linkedInvoice}
                    searchable
                  />
                )}
              </Group>
            </Section>

            <Section
              title="Cliente"
              aside={
                !values.customerId &&
                displayName(values.customer) && (
                  <Button size="xs" variant="subtle" leftSection={<IconUserPlus size={14} />} onClick={saveCustomerToBook}>
                    Salva in rubrica
                  </Button>
                )
              }
            >
              <Stack gap="sm">
                <Select
                  label="Dalla rubrica"
                  placeholder={customers.length ? 'Cerca un cliente' : 'Rubrica vuota: compila i dati qui sotto'}
                  data={customers.map((c) => ({ value: c.id, label: displayName(c) }))}
                  value={values.customerId ?? null}
                  onChange={pickCustomer}
                  searchable
                  clearable={false}
                  nothingFoundMessage="Nessun cliente con questo nome"
                />
                {values.customerId && !customerExpanded && !customerHasErrors ? (
                  <Group justify="space-between" align="flex-start">
                    <Text size="sm" c="dimmed">
                      {[
                        values.customer.vatNumber ? `P.IVA ${values.customer.vatNumber}` : values.customer.taxCode,
                        [values.customer.address.street, values.customer.address.streetNumber].filter(Boolean).join(' '),
                        `${values.customer.address.postalCode} ${values.customer.address.city}`,
                        values.customer.pec ? `PEC ${values.customer.pec}` : `Codice destinatario ${values.customer.recipientCode}`,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </Text>
                    <Button size="xs" variant="subtle" onClick={() => setCustomerExpanded(true)}>
                      Modifica dati
                    </Button>
                  </Group>
                ) : (
                  <CustomerFields
                    form={form}
                    prefix="customer"
                    addressBook={{
                      customers,
                      selected: customers.find((c) => c.id === values.customerId),
                      onPick: pickCustomer,
                    }}
                  />
                )}
              </Stack>
            </Section>

            <Section title="Righe">
              {issuer && (
                <LinesEditor
                  form={form}
                  issuer={issuer}
                  catalog={catalogQ.data?.items ?? []}
                  computed={totals?.lines ?? []}
                  hasWithholding={Boolean(values.withholding)}
                  hasPensionFund={Boolean(values.pensionFund)}
                  onFocusLine={setActiveLine}
                  activeLine={activeLine}
                />
              )}
            </Section>

            <Section title="Contributo, ritenuta e bollo">
              <Stack gap="md">
                <Switch
                  label="Cassa previdenziale (rivalsa)"
                  checked={values.pensionFund !== null}
                  onChange={(e) => toggle('pensionFund', e.currentTarget.checked)}
                />
                {values.pensionFund && (
                  <Group grow align="flex-start">
                    <Select label="Cassa" data={codeOptions(PENSION_FUNDS)} allowDeselect={false} {...form.getInputProps('pensionFund.type')} />
                    <NumberInput label="Aliquota %" decimalScale={2} {...form.getInputProps('pensionFund.rate')} />
                    <NumberInput label="IVA sul contributo %" decimalScale={2} {...form.getInputProps('pensionFund.vatRate')} />
                  </Group>
                )}
                {values.pensionFund && Number(values.pensionFund.vatRate) === 0 && (
                  <Select label="Natura IVA del contributo" data={codeOptions(VAT_NATURES)} {...form.getInputProps('pensionFund.vatNature')} />
                )}
                {values.pensionFund && (
                  <Checkbox
                    label={`I prezzi delle righe comprendono già il contributo (${Number(values.pensionFund.rate)}% compreso)`}
                    description="Il contributo si scorpora una volta sul totale delle righe; in fattura le righe vanno al netto."
                    {...form.getInputProps('pensionFund.pricesIncludeContribution', { type: 'checkbox' })}
                  />
                )}
                {values.pensionFund && (
                  <Group grow>
                    <TextInput label="Etichetta nel PDF" placeholder="Contributo INPS 4%" {...form.getInputProps('pensionFund.label')} />
                    <Checkbox
                      mt="lg"
                      label="Contributo soggetto a ritenuta"
                      {...form.getInputProps('pensionFund.withholding', { type: 'checkbox' })}
                    />
                  </Group>
                )}

                <Switch
                  label="Ritenuta d’acconto"
                  checked={values.withholding !== null}
                  disabled={values.customer.kind === 'individual'}
                  onChange={(e) => toggle('withholding', e.currentTarget.checked)}
                />
                {values.withholding && (
                  <Group grow align="flex-start">
                    <Select label="Tipo" data={codeOptions(WITHHOLDING_TYPES)} allowDeselect={false} {...form.getInputProps('withholding.type')} />
                    <NumberInput label="Aliquota %" decimalScale={2} {...form.getInputProps('withholding.rate')} />
                    <Select
                      label="Causale (modello CU)"
                      data={codeOptions(PAYMENT_REASONS)}
                      allowDeselect={false}
                      searchable
                      comboboxProps={{ width: 420, position: 'bottom-end' }}
                      {...form.getInputProps('withholding.paymentReason')}
                    />
                  </Group>
                )}

                <Switch
                  label="Marca da bollo virtuale"
                  checked={values.stampDuty !== null}
                  onChange={(e) => toggle('stampDuty', e.currentTarget.checked)}
                />
                {totals?.stampDutySuggested && (
                  <Alert color="yellow" p="xs">
                    <Group justify="space-between">
                      <Text size="sm">Le operazioni senza IVA superano 77,47 €: serve il bollo da 2,00 €.</Text>
                      <Button size="xs" variant="light" color="yellow" onClick={() => toggle('stampDuty', true)}>
                        Aggiungi bollo
                      </Button>
                    </Group>
                  </Alert>
                )}
                {values.stampDuty && (
                  <Group grow>
                    <NumberInput label="Importo" leftSection="€" decimalScale={2} {...form.getInputProps('stampDuty.amount')} />
                    <Checkbox mt="lg" label="Addebita al cliente" {...form.getInputProps('stampDuty.chargeToCustomer', { type: 'checkbox' })} />
                  </Group>
                )}
              </Stack>
            </Section>

            <Section
              title="Pagamento"
              aside={<Switch checked={values.payment !== null} onChange={(e) => toggle('payment', e.currentTarget.checked)} aria-label="Indica il pagamento" />}
            >
              {values.payment ? (
                <Stack gap="sm">
                  {bankDiffers && issuerBank && (
                    <Alert color="ink" p="sm">
                      <Group justify="space-between" gap="sm">
                        <Text size="sm">Banca diversa da quella delle Impostazioni: {issuerBankLabel}</Text>
                        <Button size="xs" variant="light" onClick={applyIssuerBank}>
                          Usa quella delle Impostazioni
                        </Button>
                      </Group>
                    </Alert>
                  )}
                  <Grid gutter="sm">
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Select label="Modalità" data={codeOptions(PAYMENT_METHODS)} allowDeselect={false} searchable {...form.getInputProps('payment.method')} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <Select label="Condizioni" data={codeOptions(PAYMENT_TERMS)} allowDeselect={false} {...form.getInputProps('payment.terms')} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 4 }}>
                      <DateInput label="Scadenza" valueFormat="DD/MM/YYYY" clearable {...form.getInputProps('payment.dueDate')} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 8 }}>
                      <TextInput label="IBAN" {...form.getInputProps('payment.iban')} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <TextInput label="Banca" {...form.getInputProps('payment.bankName')} />
                    </Grid.Col>
                    <Grid.Col span={{ base: 12, sm: 6 }}>
                      <TextInput label="Beneficiario" placeholder="Se diverso dall’emittente" {...form.getInputProps('payment.beneficiary')} />
                    </Grid.Col>
                  </Grid>
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  Nessun dato di pagamento nel documento.
                </Text>
              )}
            </Section>

            <Section title="Causale e note">
              <Stack gap="sm">
                <Textarea label="Causale" description="Finisce nell’XML e nel PDF" autosize minRows={2} {...form.getInputProps('reason')} />
                <Textarea label="Note" description="Solo nel PDF" autosize minRows={2} {...form.getInputProps('notes')} />
              </Stack>
            </Section>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack gap="sm" pos="sticky" top={68}>
            {totals && <TotalsLedger totals={totals} type={type} onTarget={onTarget} targetHint={activeLineLabel} />}
            {serviceLineCount > 1 && (
              <SegmentedControl
                size="xs"
                value={reverseScope}
                onChange={(v) => setReverseScope(v as 'all' | 'line')}
                data={[
                  { value: 'all', label: 'Ricalcola tutte le righe' },
                  { value: 'line', label: `Solo la riga ${activeLineNumber}` },
                ]}
                aria-label="Cosa ricalcolare con il calcolo a ritroso"
              />
            )}
            <Text size="xs" c="dimmed">
              Clicca su un totale sottolineato e scrivi l’importo che vuoi ottenere: ricalcolo {activeLineLabel}.
            </Text>
            <Group grow gap="xs">
              <Button variant="default" leftSection={<IconDeviceFloppy size={16} />} onClick={() => void saveDraft()} loading={saving && !issueMutation.isPending}>
                Salva bozza
              </Button>
              <Button variant="default" leftSection={<IconEye size={16} />} onClick={previewHandlers.open}>
                Anteprima
              </Button>
            </Group>
            <Button leftSection={<IconFileCheck size={16} />} disabled={hasErrors} onClick={confirmIssue} loading={issueMutation.isPending}>
              Emetti {DOCUMENT_KIND_TITLES[type].toLowerCase()}
            </Button>
            {type !== 'proforma' && (
              <Text size="xs" c="dimmed">
                Il file XML per Fatture e Corrispettivi si crea all’emissione: dopo lo scarichi dalla pagina del documento
                (pulsante «Scarica XML»).
              </Text>
            )}
            <IssuesList issues={issues} />
            {!isNew && (
              <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14} />} onClick={confirmDelete}>
                Elimina bozza
              </Button>
            )}
          </Stack>
        </Grid.Col>
      </Grid>

      <PreviewDrawer opened={preview} onClose={previewHandlers.close} document={values} />
    </Box>
  );
}
