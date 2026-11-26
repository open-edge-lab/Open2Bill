import { Combobox, Grid, SegmentedControl, Stack, Text, TextInput, useCombobox, type TextInputProps } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import { displayName, type Customer, type CustomerData, type CustomerKind } from '@open2bill/core';
import type { ReactNode } from 'react';

// Campi anagrafici del cliente, usati sia nella rubrica sia nell'editor del documento.
// `prefix` è il percorso nel form ("customer" nell'editor, "" nella rubrica).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = UseFormReturnType<any>;

const KIND_OPTIONS: { value: CustomerKind; label: string }[] = [
  { value: 'company', label: 'Azienda' },
  { value: 'professional', label: 'Professionista' },
  { value: 'individual', label: 'Privato' },
];

/** Rubrica per i suggerimenti nell'editor del documento (nella pagina Clienti non c'è). */
export interface AddressBook {
  customers: Customer[];
  /** Cliente della rubrica collegato al documento, se c'è. */
  selected?: Customer;
  /** Collega il cliente al documento e ne carica tutti i dati. */
  onPick: (id: string) => void;
}

/**
 * I campi facoltativi assenti diventano stringhe vuote. Un input con value undefined smette di
 * seguire il form e continua a mostrare il testo di prima: scegliendo un cliente senza PEC, si
 * vedrebbe ancora la PEC del cliente precedente.
 */
export function customerFormValues<T extends CustomerData>(data: T): T {
  return {
    ...data,
    companyName: data.companyName ?? '',
    firstName: data.firstName ?? '',
    lastName: data.lastName ?? '',
    vatNumber: data.vatNumber ?? '',
    taxCode: data.taxCode ?? '',
    pec: data.pec ?? '',
    address: { ...data.address, streetNumber: data.address.streetNumber ?? '', province: data.address.province ?? '' },
  };
}

interface Suggestion {
  value: string;
  label: ReactNode;
  onPick: () => void;
}

/** Campo di testo con un menu di suggerimenti presi dalla rubrica. */
function SuggestInput({
  stored,
  matches,
  onChange,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { stored: Suggestion[]; matches: Suggestion[] }) {
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const all = [...stored, ...matches];
  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(value) => {
        all.find((s) => s.value === value)?.onPick();
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target>
        <TextInput
          {...props}
          onChange={(e) => {
            onChange?.(e);
            combobox.openDropdown();
            combobox.updateSelectedOptionIndex();
          }}
          onFocus={(e) => {
            combobox.openDropdown();
            onFocus?.(e);
          }}
          onBlur={(e) => {
            combobox.closeDropdown();
            onBlur?.(e);
          }}
          onClick={() => combobox.openDropdown()}
        />
      </Combobox.Target>
      <Combobox.Dropdown hidden={all.length === 0}>
        <Combobox.Options>
          {stored.length > 0 && (
            <Combobox.Group label="Dato in rubrica">
              {stored.map((s) => (
                <Combobox.Option value={s.value} key={s.value}>
                  {s.label}
                </Combobox.Option>
              ))}
            </Combobox.Group>
          )}
          {matches.length > 0 && (
            <Combobox.Group label="Clienti in rubrica: sceglilo per caricare tutti i dati">
              {matches.map((s) => (
                <Combobox.Option value={s.value} key={s.value}>
                  {s.label}
                </Combobox.Option>
              ))}
            </Combobox.Group>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

const MAX_MATCHES = 8;

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function CustomerFields({ form, prefix = '', addressBook }: { form: AnyForm; prefix?: string; addressBook?: AddressBook }) {
  const p = (field: string) => (prefix ? `${prefix}.${field}` : field);
  const values = form.getValues();
  const kind = values[prefix] ? values[prefix].kind : values.kind;
  const upper = (field: string) => {
    const props = form.getInputProps(p(field));
    return {
      ...props,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => props.onChange(e.currentTarget.value.toUpperCase()),
    };
  };

  /** Il valore salvato in rubrica per il cliente collegato, se è diverso da quello scritto. */
  function storedSuggestion(field: string): Suggestion[] {
    const saved = String(getPath(addressBook?.selected, field) ?? '').trim();
    const current = String(getPath(values, p(field)) ?? '').trim();
    if (!saved || saved === current) return [];
    return [
      {
        value: `stored:${field}`,
        label: <Text size="sm">{saved}</Text>,
        onPick: () => form.setFieldValue(p(field), saved),
      },
    ];
  }

  /** Clienti della rubrica che corrispondono al testo scritto (per nome o per partita IVA). */
  function customerMatches(field: string, by: 'name' | 'vatNumber'): Suggestion[] {
    if (!addressBook) return [];
    const typed = String(getPath(values, p(field)) ?? '').trim();
    const query = by === 'vatNumber' ? typed.replace(/\D/g, '') : typed.toLowerCase();
    if (query.length < 2) return [];
    return addressBook.customers
      .filter((c) => c.id !== addressBook.selected?.id)
      .filter((c) => (by === 'vatNumber' ? (c.vatNumber ?? '').includes(query) : displayName(c).toLowerCase().includes(query)))
      .slice(0, MAX_MATCHES)
      .map((c) => ({
        value: `pick:${c.id}`,
        label: (
          <div>
            <Text size="sm">{displayName(c)}</Text>
            <Text size="xs" c="dimmed">
              {[c.vatNumber ? `P.IVA ${c.vatNumber}` : c.taxCode, c.address.city].filter(Boolean).join(' · ')}
            </Text>
          </div>
        ),
        onPick: () => addressBook.onPick(c.id),
      }));
  }

  /** Campo con i suggerimenti della rubrica, se c'è; altrimenti un campo semplice. */
  function field(name: string, props: TextInputProps, search?: 'name' | 'vatNumber', inputProps = form.getInputProps(p(name))) {
    const key = form.key(p(name));
    if (!addressBook) return <TextInput key={key} {...props} {...inputProps} />;
    return (
      <SuggestInput
        key={key}
        {...props}
        {...inputProps}
        stored={storedSuggestion(name)}
        matches={search ? customerMatches(name, search) : []}
      />
    );
  }

  return (
    <Stack gap="sm">
      <SegmentedControl data={KIND_OPTIONS} {...form.getInputProps(p('kind'))} key={form.key(p('kind'))} />
      <Grid gutter="sm">
        {kind === 'company' ? (
          <Grid.Col span={12}>{field('companyName', { label: 'Denominazione', required: true }, 'name')}</Grid.Col>
        ) : (
          <>
            <Grid.Col span={{ base: 12, sm: 6 }}>{field('firstName', { label: 'Nome', required: true })}</Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>{field('lastName', { label: 'Cognome', required: true })}</Grid.Col>
          </>
        )}
        {kind !== 'individual' && (
          <Grid.Col span={{ base: 12, sm: 6 }}>
            {field(
              'vatNumber',
              { label: 'Partita IVA', description: '11 cifre, il prefisso IT si può omettere', required: true },
              'vatNumber',
            )}
          </Grid.Col>
        )}
        <Grid.Col span={{ base: 12, sm: 6 }}>
          {field('taxCode', { label: 'Codice fiscale', required: kind === 'individual' }, undefined, upper('taxCode'))}
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 9 }}>{field('address.street', { label: 'Indirizzo', required: true })}</Grid.Col>
        <Grid.Col span={{ base: 12, sm: 3 }}>{field('address.streetNumber', { label: 'Civico' })}</Grid.Col>
        <Grid.Col span={{ base: 4, sm: 3 }}>{field('address.postalCode', { label: 'CAP', required: true, maxLength: 5 })}</Grid.Col>
        <Grid.Col span={{ base: 8, sm: 6 }}>{field('address.city', { label: 'Comune', required: true })}</Grid.Col>
        <Grid.Col span={{ base: 4, sm: 3 }}>
          {field('address.province', { label: 'Provincia', maxLength: 2 }, undefined, upper('address.province'))}
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          {field(
            'recipientCode',
            {
              label: 'Codice destinatario (SDI)',
              description: kind === 'individual' ? 'Per i privati resta 0000000' : '7 caratteri, oppure 0000000 con la PEC',
              maxLength: 7,
            },
            undefined,
            upper('recipientCode'),
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          {field('pec', { label: 'PEC', description: 'Usata se il codice destinatario è 0000000' })}
        </Grid.Col>
      </Grid>
      {kind === 'individual' && (
        <Text size="xs" c="dimmed">
          Ai privati non si applica la ritenuta d’acconto: la fattura arriva nella loro area riservata.
        </Text>
      )}
    </Stack>
  );
}
