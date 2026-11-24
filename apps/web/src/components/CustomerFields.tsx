import { Grid, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { CustomerKind } from '@open2bill/core';

// Campi anagrafici del cliente, usati sia nella rubrica sia nell'editor del documento.
// `prefix` è il percorso nel form ("customer" nell'editor, "" nella rubrica).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = UseFormReturnType<any>;

const KIND_OPTIONS: { value: CustomerKind; label: string }[] = [
  { value: 'company', label: 'Azienda' },
  { value: 'professional', label: 'Professionista' },
  { value: 'individual', label: 'Privato' },
];

export function CustomerFields({ form, prefix = '' }: { form: AnyForm; prefix?: string }) {
  const p = (field: string) => (prefix ? `${prefix}.${field}` : field);
  const kind = form.getValues()[prefix] ? form.getValues()[prefix].kind : form.getValues().kind;
  const upper = (field: string) => {
    const props = form.getInputProps(p(field));
    return {
      ...props,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => props.onChange(e.currentTarget.value.toUpperCase()),
    };
  };

  return (
    <Stack gap="sm">
      <SegmentedControl data={KIND_OPTIONS} {...form.getInputProps(p('kind'))} key={form.key(p('kind'))} />
      <Grid gutter="sm">
        {kind === 'company' ? (
          <Grid.Col span={12}>
            <TextInput label="Denominazione" required {...form.getInputProps(p('companyName'))} key={form.key(p('companyName'))} />
          </Grid.Col>
        ) : (
          <>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput label="Nome" required {...form.getInputProps(p('firstName'))} key={form.key(p('firstName'))} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput label="Cognome" required {...form.getInputProps(p('lastName'))} key={form.key(p('lastName'))} />
            </Grid.Col>
          </>
        )}
        {kind !== 'individual' && (
          <Grid.Col span={{ base: 12, sm: 6 }}>
            <TextInput
              label="Partita IVA"
              description="11 cifre, il prefisso IT si può omettere"
              required
              {...form.getInputProps(p('vatNumber'))}
              key={form.key(p('vatNumber'))}
            />
          </Grid.Col>
        )}
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label="Codice fiscale"
            required={kind === 'individual'}
            {...upper('taxCode')}
            key={form.key(p('taxCode'))}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 9 }}>
          <TextInput label="Indirizzo" required {...form.getInputProps(p('address.street'))} key={form.key(p('address.street'))} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 3 }}>
          <TextInput label="Civico" {...form.getInputProps(p('address.streetNumber'))} key={form.key(p('address.streetNumber'))} />
        </Grid.Col>
        <Grid.Col span={{ base: 4, sm: 3 }}>
          <TextInput label="CAP" required maxLength={5} {...form.getInputProps(p('address.postalCode'))} key={form.key(p('address.postalCode'))} />
        </Grid.Col>
        <Grid.Col span={{ base: 8, sm: 6 }}>
          <TextInput label="Comune" required {...form.getInputProps(p('address.city'))} key={form.key(p('address.city'))} />
        </Grid.Col>
        <Grid.Col span={{ base: 4, sm: 3 }}>
          <TextInput label="Provincia" maxLength={2} {...upper('address.province')} key={form.key(p('address.province'))} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput
            label="Codice destinatario"
            description={kind === 'individual' ? 'Per i privati resta 0000000' : '7 caratteri, oppure 0000000 con la PEC'}
            maxLength={7}
            {...upper('recipientCode')}
            key={form.key(p('recipientCode'))}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6 }}>
          <TextInput label="PEC" description="Usata se il codice destinatario è 0000000" {...form.getInputProps(p('pec'))} key={form.key(p('pec'))} />
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
