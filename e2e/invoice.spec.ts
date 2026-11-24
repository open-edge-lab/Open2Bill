import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Flusso completo: nuova fattura → calcolo a ritroso dal netto → emissione → download XML.

test('fattura con rivalsa INPS e ritenuta, dal netto desiderato all’XML', async ({ page }) => {
  await page.goto('/documents/new?type=TD01&customerId=esempio-software-s-r-l');
  await expect(page.getByRole('heading', { name: 'Nuova fattura' })).toBeVisible();

  await page.getByLabel('Descrizione').fill('Progettazione e sviluppo software');

  // Calcolo a ritroso: scrivo il netto che voglio ricevere
  await page.getByRole('button', { name: '€ 0,00' }).last().click();
  const target = page.getByLabel('Valore desiderato per Netto da ricevere');
  await target.fill('1530');
  await target.press('Enter');
  await expect(page.getByLabel('Prezzo')).toHaveValue('1.442,31');
  await expect(page.getByText('€ 1.830,00').first()).toBeVisible();

  await page.getByRole('button', { name: 'Emetti fattura' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Emetti' }).click();

  // emissione: XML + validazione XSD + primo avvio del browser per il PDF
  await expect(page).toHaveURL(/\/documents\/\d{4}-invoice-0001$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: /Fattura n\. 1 del/ })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Scarica XML' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('ITRSSMRA80A01H501U_00001.xml');
  const xml = await fs.readFile(await download.path(), 'utf8');
  expect(xml).toContain('<ImportoContributoCassa>57.69</ImportoContributoCassa>');
  expect(xml).toContain('<ImportoTotaleDocumento>1830.00</ImportoTotaleDocumento>');
  expect(xml).toContain('<ImportoRitenuta>300.00</ImportoRitenuta>');
  expect(xml).toContain('<ImportoPagamento>1530.00</ImportoPagamento>');
});
