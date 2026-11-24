import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Palette: blu inchiostro (lo stesso del PDF), verde timbro per i documenti emessi,
// superfici chiare e fredde. Bordi sottili invece di ombre.

const ink: MantineColorsTuple = [
  '#eef3f8',
  '#dce6f0',
  '#b6cadf',
  '#8dadcd',
  '#6a93bd',
  '#5283b3',
  '#3f6e9d',
  '#1f4e79',
  '#193f62',
  '#12304b',
];

const stamp: MantineColorsTuple = [
  '#ecf6f1',
  '#d6ece1',
  '#acd8c3',
  '#7fc2a3',
  '#5aae88',
  '#43a077',
  '#348c66',
  '#2e7d5b',
  '#24654a',
  '#184c37',
];

export const theme = createTheme({
  primaryColor: 'ink',
  primaryShade: 7,
  colors: { ink, stamp },
  fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', Consolas, monospace",
  headings: {
    fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '1.625rem', lineHeight: '1.25' },
      h2: { fontSize: '1.25rem', lineHeight: '1.3' },
      h3: { fontSize: '1.0625rem', lineHeight: '1.35' },
    },
  },
  defaultRadius: 'sm',
  black: '#1d232b',
  components: {
    Button: { defaultProps: { radius: 'sm' } },
    Paper: { defaultProps: { radius: 'sm' } },
    NumberInput: { defaultProps: { decimalSeparator: ',', thousandSeparator: '.', hideControls: true } },
    Tooltip: { defaultProps: { openDelay: 300 } },
  },
});
