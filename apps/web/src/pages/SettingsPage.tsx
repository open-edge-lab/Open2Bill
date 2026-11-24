import {
  Alert,
  Button,
  Center,
  Checkbox,
  ColorInput,
  Grid,
  Group,
  Loader,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconFolderOpen, IconTemplate } from '@tabler/icons-react';
import {
  PAYMENT_METHODS,
  PAYMENT_REASONS,
  PENSION_FUNDS,
  TAX_REGIMES,
  WITHHOLDING_TYPES,
  type IssuerInput,
} from '@open2bill/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError, api, errorMessage } from '../api/client';
import { keys, useAppInfo, useIssuer } from '../api/hooks';
import type { IssuerResponse } from '../api/types';
import { IssuesList } from '../components/IssuesList';
import { desktop } from '../lib/desktop';

const codeOptions = (list: { code: string; label: string }[]) => list.map((e) => ({ value: e.code, label: `${e.code} - ${e.label}` }));

const EMPTY_ISSUER: IssuerInput = {
  firstName: '',
  lastName: '',
  companyName: '',
  vatCountry: 'IT',
  vatNumber: '',
  taxCode: '',
  taxRegime: 'RF01',
  address: { street: '', streetNumber: '', postalCode: '', city: '', province: '', country: 'IT' },
  contacts: { email: '', pec: '', phone: '' },
  payment: { method: 'MP05', terms: 'TP02', bankName: '', iban: '', beneficiary: '', dueDays: 30 },
  defaults: {
    vatRate: 22,
    pensionFund: null,
    withholding: null,
    stampDuty: { amount: 2, chargeToCustomer: true },
    reason: '',
  },
  numbering: { invoice: '{n}', creditNote: 'NC{n}', proforma: 'PF{n}', pdfFileName: '{year}-{type}-{number}_{customer}' },
  pdf: { template: 'default', accentColor: '#1f4e79', logo: '', footer: '', labels: {} },
};

/** Riempie i campi assenti con stringhe vuote, così il form resta controllato. */
function withEmptyStrings(issuer: Partial<IssuerInput>): IssuerInput {
  const merge = (base: unknown, value: unknown): unknown => {
    if (value === undefined) return base;
    if (base && typeof base === 'object' && !Array.isArray(base) && value && typeof value === 'object') {
      const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
      for (const [k, v] of Object.entries(value)) out[k] = merge((base as Record<string, unknown>)[k], v);
      return out;
    }
    return value;
  };
  return merge(EMPTY_ISSUER, issuer) as IssuerInput;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Paper withBorder p="md">
      <Title order={3}>{title}</Title>
      {description && (
        <Text size="sm" c="dimmed" mb="sm">
          {description}
        </Text>
      )}
      <Stack gap="sm" mt={description ? 0 : 'sm'}>
        {children}
      </Stack>
    </Paper>
  );
}

function IssuerForm({ initial, isFirstRun }: { initial: IssuerInput; isFirstRun: boolean }) {
  const qc = useQueryClient();
  const form = useForm<IssuerInput>({ mode: 'controlled', initialValues: initial });
  const v = form.getValues();
  const [personKind, setPersonKind] = useState<'person' | 'company'>(initial.companyName ? 'company' : 'person');
  const [response, setResponse] = useState<IssuerResponse | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(values: IssuerInput) {
    setBusy(true);
    const body = {
      ...values,
      companyName: personKind === 'company' ? values.companyName : '',
      firstName: personKind === 'person' ? values.firstName : '',
      lastName: personKind === 'person' ? values.lastName : '',
    };
    try {
      const res = await api.put<IssuerResponse>('/api/issuer', body);
      setResponse(res);
      form.resetDirty();
      await qc.invalidateQueries({ queryKey: keys.issuer });
      await qc.invalidateQueries({ queryKey: keys.app });
      notifications.show({ message: 'Dati dell’emittente salvati in issuer.yaml.', color: 'stamp' });
    } catch (err) {
      if (err instanceof ApiError) {
        form.setErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      }
      notifications.show({ title: 'Dati non salvati', message: errorMessage(err), color: 'red' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={form.onSubmit(submit)}>
      <Stack gap="md">
        {isFirstRun && (
          <Alert color="ink" title="Primo avvio">
            Inserisci i tuoi dati: verranno salvati nel file issuer.yaml della cartella dati, che puoi anche modificare a mano.
          </Alert>
        )}

        <Section title="Anagrafica">
          <SegmentedControl
            value={personKind}
            onChange={(val) => setPersonKind(val as 'person' | 'company')}
            data={[
              { value: 'person', label: 'Persona fisica' },
              { value: 'company', label: 'Società' },
            ]}
            w="fit-content"
          />
          <Grid gutter="sm">
            {personKind === 'company' ? (
              <Grid.Col span={12}>
                <TextInput label="Denominazione" required {...form.getInputProps('companyName')} />
              </Grid.Col>
            ) : (
              <>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <TextInput label="Nome" required {...form.getInputProps('firstName')} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <TextInput label="Cognome" required {...form.getInputProps('lastName')} />
                </Grid.Col>
              </>
            )}
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="Partita IVA" description="11 cifre, il prefisso IT si può omettere" required {...form.getInputProps('vatNumber')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="Codice fiscale" {...form.getInputProps('taxCode')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <Select label="Regime fiscale" data={codeOptions(TAX_REGIMES)} allowDeselect={false} searchable {...form.getInputProps('taxRegime')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 9 }}>
              <TextInput label="Indirizzo" required {...form.getInputProps('address.street')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 3 }}>
              <TextInput label="Civico" {...form.getInputProps('address.streetNumber')} />
            </Grid.Col>
            <Grid.Col span={{ base: 4, sm: 3 }}>
              <TextInput label="CAP" required maxLength={5} {...form.getInputProps('address.postalCode')} />
            </Grid.Col>
            <Grid.Col span={{ base: 8, sm: 6 }}>
              <TextInput label="Comune" required {...form.getInputProps('address.city')} />
            </Grid.Col>
            <Grid.Col span={{ base: 4, sm: 3 }}>
              <TextInput label="Provincia" maxLength={2} {...form.getInputProps('address.province')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="Email" {...form.getInputProps('contacts.email')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="PEC" {...form.getInputProps('contacts.pec')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput label="Telefono" {...form.getInputProps('contacts.phone')} />
            </Grid.Col>
          </Grid>
        </Section>

        <Section title="Pagamento" description="Proposto in ogni nuovo documento.">
          <Grid gutter="sm">
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Select label="Modalità" data={codeOptions(PAYMENT_METHODS)} allowDeselect={false} searchable {...form.getInputProps('payment.method')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <NumberInput label="Giorni per la scadenza" min={0} max={999} decimalScale={0} {...form.getInputProps('payment.dueDays')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 7 }}>
              <TextInput label="IBAN" {...form.getInputProps('payment.iban')} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 5 }}>
              <TextInput label="Banca" {...form.getInputProps('payment.bankName')} />
            </Grid.Col>
          </Grid>
        </Section>

        <Section title="Valori predefiniti" description="Ogni nuovo documento parte con queste impostazioni; nel documento puoi cambiarle.">
          <NumberInput label="Aliquota IVA" w={160} rightSection="%" decimalScale={2} {...form.getInputProps('defaults.vatRate')} />

          <Switch
            label="Cassa previdenziale (es. rivalsa INPS 4%)"
            checked={Boolean(v.defaults?.pensionFund)}
            onChange={(e) =>
              form.setFieldValue(
                'defaults.pensionFund',
                e.currentTarget.checked
                  ? {
                      type: 'TC22',
                      rate: 4,
                      vatRate: Number(v.defaults?.vatRate ?? 22),
                      withholding: true,
                      label: 'Contrib. INPS – gest. separata 4%',
                      pricesIncludeContribution: false,
                    }
                  : null,
              )
            }
          />
          {v.defaults?.pensionFund && (
            <Group grow align="flex-start">
              <Select label="Cassa" data={codeOptions(PENSION_FUNDS)} allowDeselect={false} {...form.getInputProps('defaults.pensionFund.type')} />
              <NumberInput label="Aliquota %" decimalScale={2} {...form.getInputProps('defaults.pensionFund.rate')} />
              <TextInput label="Etichetta" {...form.getInputProps('defaults.pensionFund.label')} />
              <Checkbox mt="lg" label="Soggetto a ritenuta" {...form.getInputProps('defaults.pensionFund.withholding', { type: 'checkbox' })} />
            </Group>
          )}
          {v.defaults?.pensionFund && (
            <Checkbox
              label="Nei nuovi documenti i prezzi delle righe comprendono già il contributo"
              {...form.getInputProps('defaults.pensionFund.pricesIncludeContribution', { type: 'checkbox' })}
            />
          )}

          <Switch
            label="Ritenuta d’acconto"
            checked={Boolean(v.defaults?.withholding)}
            onChange={(e) =>
              form.setFieldValue('defaults.withholding', e.currentTarget.checked ? { type: 'RT01', rate: 20, paymentReason: 'A' } : null)
            }
          />
          {v.defaults?.withholding && (
            <Group grow align="flex-start">
              <Select label="Tipo" data={codeOptions(WITHHOLDING_TYPES)} allowDeselect={false} {...form.getInputProps('defaults.withholding.type')} />
              <NumberInput label="Aliquota %" decimalScale={2} {...form.getInputProps('defaults.withholding.rate')} />
              <Select
                label="Causale"
                data={codeOptions(PAYMENT_REASONS)}
                allowDeselect={false}
                searchable
                comboboxProps={{ width: 420 }}
                {...form.getInputProps('defaults.withholding.paymentReason')}
              />
            </Group>
          )}
          <TextInput label="Causale standard" description="Testo proposto nella causale dei nuovi documenti" {...form.getInputProps('defaults.reason')} />
        </Section>

        <Section title="Numerazione e PDF" description="{n} numero, {n:3} numero con zeri, {yyyy} anno, {yy} anno a due cifre.">
          <Group grow align="flex-start">
            <TextInput label="Fatture" {...form.getInputProps('numbering.invoice')} />
            <TextInput label="Note di credito" {...form.getInputProps('numbering.creditNote')} />
            <TextInput label="Proforma" {...form.getInputProps('numbering.proforma')} />
          </Group>
          <Group grow align="flex-start">
            <ColorInput label="Colore del PDF" {...form.getInputProps('pdf.accentColor')} />
            <TextInput label="Logo" description="File nella cartella dati, es. logo.png" {...form.getInputProps('pdf.logo')} />
          </Group>
          <TextInput label="Piè di pagina del PDF" {...form.getInputProps('pdf.footer')} />
        </Section>

        {response && <IssuesList issues={response.issues} />}

        <Group justify="flex-end">
          <Button type="submit" loading={busy} disabled={!isFirstRun && !form.isDirty()}>
            Salva dati emittente
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function SettingsPage() {
  const app = useAppInfo();
  const issuer = useIssuer(Boolean(app.data?.hasIssuer));
  const [templateMsg, setTemplateMsg] = useState<string | null>(null);

  async function customizeTemplate() {
    try {
      const res = await api.post<{ created: boolean; dir?: string }>('/api/templates/customize', { name: 'custom' });
      setTemplateMsg(
        res.created
          ? 'Template copiato in templates/custom. Modificalo e imposta pdf.template: custom in issuer.yaml.'
          : 'Il template templates/custom esiste già.',
      );
    } catch (err) {
      setTemplateMsg(errorMessage(err));
    }
  }

  if (app.isPending || (app.data?.hasIssuer && issuer.isPending)) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    );
  }

  return (
    <Stack maw={980} mx="auto" gap="md">
      <div>
        <Title order={1}>Impostazioni</Title>
        <Text c="dimmed" size="sm">
          Dati dell’emittente, valori predefiniti e aspetto del PDF.
        </Text>
      </div>

      {issuer.error && (
        <Alert color="red" title="issuer.yaml non valido">
          {errorMessage(issuer.error)}
        </Alert>
      )}

      {app.data && (!app.data.hasIssuer || issuer.data) && (
        <IssuerForm
          key={issuer.dataUpdatedAt}
          initial={withEmptyStrings((issuer.data?.issuer as IssuerInput | undefined) ?? {})}
          isFirstRun={!app.data.hasIssuer}
        />
      )}

      <Paper withBorder p="md">
        <Title order={3}>Cartella dati e template</Title>
        <Stack gap="sm" mt="sm">
          {app.data?.dataDir && (
            <Text size="sm">
              Cartella dati: <Text span className="code">{app.data.dataDir}</Text>
            </Text>
          )}
          <Group gap="xs">
            {desktop && (
              <>
                <Button variant="default" leftSection={<IconFolderOpen size={16} />} onClick={() => desktop?.openDataDir()}>
                  Apri cartella dati
                </Button>
                <Button variant="default" onClick={() => desktop?.chooseDataDir()}>
                  Cambia cartella…
                </Button>
              </>
            )}
            <Button variant="default" leftSection={<IconTemplate size={16} />} onClick={customizeTemplate}>
              Personalizza template PDF
            </Button>
          </Group>
          {templateMsg && <Text size="sm">{templateMsg}</Text>}
        </Stack>
      </Paper>
    </Stack>
  );
}
