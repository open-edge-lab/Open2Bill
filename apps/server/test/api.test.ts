import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateInvoiceXsd } from '@open2bill/core/xsd';
import { hashPassword } from '../src/auth';
import { makeTestServer } from './helpers';

type Server = Awaited<ReturnType<typeof makeTestServer>>;

const goldenLines = [
  {
    description: 'Progettazione e sviluppo software\n“Gestionale di esempio”',
    quantity: 1,
    unitPrice: 1442.31,
    vatRate: 22,
  },
];

describe('API documenti', () => {
  let s: Server;
  const year = new Date().getFullYear();

  beforeAll(async () => {
    s = await makeTestServer();
  });
  afterAll(async () => {
    await s.app.close();
    await fs.rm(s.dataDir, { recursive: true, force: true });
  });

  const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    s.app.inject({ method, url, payload: payload as object | undefined });

  async function newDraft(type = 'TD01', overrides: Record<string, unknown> = {}) {
    const tpl = (await inject('GET', `/api/documents/new?type=${type}&customerId=esempio-software-s-r-l`)).json();
    const res = await inject('POST', '/api/documents', { ...tpl, lines: goldenLines, ...overrides });
    expect(res.statusCode).toBe(201);
    return res.json() as { document: { id: string }; totals: Record<string, unknown>; issues: unknown[] };
  }

  it('legge emittente e clienti dagli YAML', async () => {
    const issuer = (await inject('GET', '/api/issuer')).json();
    expect(issuer.issuer.lastName).toBe('Rossi');
    expect(issuer.issues).toEqual([]);
    const customers = (await inject('GET', '/api/customers')).json();
    expect(customers.map((c: { id: string }) => c.id)).toEqual(['esempio-software-s-r-l', 'laura-bianchi']);
  });

  it('nuovo documento con i predefiniti dell’emittente', async () => {
    const tpl = (await inject('GET', '/api/documents/new?customerId=esempio-software-s-r-l')).json();
    expect(tpl.id).toMatch(/^draft-/);
    expect(tpl.customer.companyName).toBe('Esempio Software S.r.l.');
    expect(tpl.pensionFund).toMatchObject({ type: 'TC22', rate: 4 });
    expect(tpl.withholding).toMatchObject({ type: 'RT01', rate: 20, paymentReason: 'A' });
    expect(tpl.payment.iban).toBe('IT60X0542811101000000123456');
  });

  it('bozza → emissione: numero, XML valido, PDF', async () => {
    const draft = await newDraft();
    expect(draft.totals).toMatchObject({ documentTotal: '1830.00', netPayable: '1530.00' });

    const res = await inject('POST', `/api/documents/${draft.document.id}/issue`);
    expect(res.statusCode).toBe(200);
    const { document, warnings } = res.json();
    expect(warnings).toEqual([]);
    expect(document).toMatchObject({
      id: `${year}-invoice-0001`,
      number: '1',
      status: 'issued',
      transmissionSequence: '00001',
      xmlFileName: 'ITRSSMRA80A01H501U_00001.xml',
    });
    expect(document.pdfFileName).toBe(`${year}-invoice-1_esempio-software-s-r-l.pdf`);

    const xml = await fs.readFile(path.join(s.dataDir, 'output', String(year), document.xmlFileName), 'utf8');
    expect((await validateInvoiceXsd(xml)).valid).toBe(true);
    expect(xml).toContain('<ImportoPagamento>1530.00</ImportoPagamento>');

    // la bozza non esiste più, il documento emesso sì
    expect((await inject('GET', `/api/documents/${draft.document.id}`)).statusCode).toBe(404);
    expect((await inject('GET', `/api/documents/${document.id}`)).statusCode).toBe(200);

    // download
    const dl = await inject('GET', `/api/documents/${document.id}/xml`);
    expect(dl.headers['content-disposition']).toContain('ITRSSMRA80A01H501U_00001.xml');

    // un documento emesso non si modifica né si elimina
    expect((await inject('PUT', `/api/documents/${document.id}`, document)).statusCode).toBe(409);
    expect((await inject('DELETE', `/api/documents/${document.id}`)).statusCode).toBe(409);
  });

  it('numerazione progressiva e progressivo invio', async () => {
    const draft = await newDraft();
    const { document } = (await inject('POST', `/api/documents/${draft.document.id}/issue`)).json();
    expect(document.number).toBe('2');
    expect(document.transmissionSequence).toBe('00002');
  });

  it('proforma: numerazione propria, niente XML, conversione in fattura', async () => {
    const draft = await newDraft('proforma');
    const { document: proforma } = (await inject('POST', `/api/documents/${draft.document.id}/issue`)).json();
    expect(proforma).toMatchObject({ number: 'PF1', id: `${year}-proforma-0001` });
    expect(proforma.xmlFileName).toBeUndefined();
    expect(proforma.transmissionSequence).toBeUndefined();

    const converted = (await inject('POST', `/api/documents/${proforma.id}/convert`)).json();
    expect(converted).toMatchObject({ type: 'TD01', status: 'draft', sourceProformaId: proforma.id });
    expect((await inject('POST', `/api/documents/${proforma.id}/convert`)).statusCode).toBe(409);

    const { document: invoice } = (await inject('POST', `/api/documents/${converted.id}/issue`)).json();
    expect(invoice.number).toBe('3');
    const after = (await inject('GET', `/api/documents/${proforma.id}`)).json();
    expect(after.document.convertedToId).toBe(invoice.id);
  });

  it('nota di credito collegata alla fattura', async () => {
    const credit = (await inject('POST', `/api/documents/${year}-invoice-0001/credit-note`)).json();
    expect(credit).toMatchObject({ type: 'TD04', linkedInvoice: { number: '1' } });
    const { document } = (await inject('POST', `/api/documents/${credit.id}/issue`)).json();
    expect(document).toMatchObject({ number: 'NC1', id: `${year}-credit-note-0001` });
    const xml = await fs.readFile(path.join(s.dataDir, 'output', String(year), document.xmlFileName), 'utf8');
    expect(xml).toContain('<TipoDocumento>TD04</TipoDocumento>');
    expect(xml).toContain('<IdDocumento>1</IdDocumento>');
  });

  it('stato "caricata su SdI"', async () => {
    const res = await inject('POST', `/api/documents/${year}-invoice-0001/status`, {
      status: 'uploaded',
      uploadedAt: '2026-01-10',
      sdiNotes: 'Consegnata',
    });
    expect(res.json()).toMatchObject({ status: 'uploaded', uploadedAt: '2026-01-10', sdiNotes: 'Consegnata' });
  });

  it('errori di validazione bloccano l’emissione (422)', async () => {
    const draft = await newDraft('TD01', { lines: [{ description: 'Esente', unitPrice: 100, vatRate: 0 }] });
    const res = await inject('POST', `/api/documents/${draft.document.id}/issue`);
    expect(res.statusCode).toBe(422);
    expect(res.json().issues).toContainEqual(expect.objectContaining({ path: 'lines.0.vatNature' }));
  });

  it('validazione completa con XSD prima di emettere', async () => {
    const tpl = (await inject('GET', '/api/documents/new?customerId=esempio-software-s-r-l')).json();
    const res = (await inject('POST', '/api/validate', { ...tpl, lines: goldenLines })).json();
    expect(res.ok).toBe(true);
    expect(res.xsd.valid).toBe(true);
  });

  it('elenco documenti con totali', async () => {
    const list = (await inject('GET', '/api/documents')).json();
    const first = list.find((d: { id: string }) => d.id === `${year}-invoice-0001`);
    expect(first).toMatchObject({ customerName: 'Esempio Software S.r.l.', documentTotal: '1830.00', netPayable: '1530.00' });
  });

  it('anteprima HTML con importi all’italiana', async () => {
    const tpl = (await inject('GET', '/api/documents/new?customerId=esempio-software-s-r-l')).json();
    const res = await inject('POST', '/api/preview/html', { ...tpl, lines: goldenLines });
    expect(res.headers['content-type']).toContain('text/html');
    const html = res.body;
    expect(html).toContain('1.442,31');
    expect(html).toContain('1.530,00');
    expect(html).toContain('Netto da ricevere');
    expect(html).toContain('Contrib. INPS – gest. separata 4%');
    expect(html).toContain('IT60 X054 2811 1010 0000 0123 456');
  });

  it('clienti: crea, aggiorna conservando i commenti, elimina', async () => {
    const created = (
      await inject('POST', '/api/customers', {
        kind: 'professional',
        firstName: 'Paolo',
        lastName: 'Verdi',
        vatNumber: '01122334459',
        address: { street: 'Via Po', postalCode: '10100', city: 'Torino', province: 'TO' },
        recipientCode: 'XYZ9876',
      })
    ).json();
    expect(created.customer.id).toBe('paolo-verdi');

    const file = path.join(s.dataDir, 'customers', 'esempio-software-s-r-l.yaml');
    const before = await fs.readFile(file, 'utf8');
    const existing = (await inject('GET', '/api/customers/esempio-software-s-r-l')).json();
    await inject('PUT', '/api/customers/esempio-software-s-r-l', { ...existing, recipientCode: 'NEW1234' });
    const after = await fs.readFile(file, 'utf8');
    expect(before).toContain('# Cliente di esempio (FITTIZIO)');
    expect(after).toContain('# Cliente di esempio (FITTIZIO)');
    expect(after).toContain('codice destinatario SdI');
    expect(after).toContain('NEW1234');

    expect((await inject('DELETE', '/api/customers/paolo-verdi')).statusCode).toBe(204);
  });

  it('ignora i campi di emissione inviati dal client (niente path traversal nei download)', async () => {
    const draft = await newDraft('TD01', {
      xmlFileName: '../../issuer.yaml',
      pdfFileName: '..\\..\\issuer.yaml',
      status: 'issued',
      number: '999',
      convertedToId: `${year}-invoice-0001`,
    });
    const saved = (await inject('GET', `/api/documents/${draft.document.id}`)).json().document;
    expect(saved).toMatchObject({ status: 'draft' });
    expect(saved.xmlFileName).toBeUndefined();
    expect(saved.pdfFileName).toBeUndefined();
    expect(saved.number).toBeUndefined();
    expect(saved.convertedToId).toBeUndefined();
    expect((await inject('GET', `/api/documents/${draft.document.id}/xml`)).statusCode).toBe(404);
  });

  it('non serve file fuori da output/ anche se lo YAML del documento è manomesso', async () => {
    const file = path.join(s.dataDir, 'documents', String(year), `${year}-invoice-0002.yaml`);
    const original = await fs.readFile(file, 'utf8');
    try {
      await fs.writeFile(file, original.replace(/xmlFileName: .*/, 'xmlFileName: ../../issuer.yaml'));
      const res = await inject('GET', `/api/documents/${year}-invoice-0002/xml`);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('vatNumber');
    } finally {
      await fs.writeFile(file, original);
    }
  });

  it('rifiuta id con path traversal', async () => {
    const res = await inject('GET', '/api/documents/..%2F..%2Fissuer');
    expect(res.statusCode).toBe(400);
  });
});

describe('banca dell’emittente nelle bozze', () => {
  it('cambiando la banca, le bozze con la banca di prima la aggiornano; le altre no', async () => {
    const s = await makeTestServer();
    const inject = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
      s.app.inject({ method, url, payload: payload as object | undefined });
    const newDraft = async (overrides: Record<string, unknown> = {}) => {
      const tpl = (await inject('GET', '/api/documents/new?customerId=esempio-software-s-r-l')).json();
      const res = await inject('POST', '/api/documents', { ...tpl, lines: goldenLines, ...overrides });
      expect(res.statusCode).toBe(201);
      return res.json().document as { id: string; payment: Record<string, unknown> };
    };
    const paymentOf = async (id: string) => (await inject('GET', `/api/documents/${id}`)).json().document.payment;
    try {
      const followsDefault = await newDraft();
      const tpl = (await inject('GET', '/api/documents/new')).json();
      const customBank = await newDraft({ payment: { ...tpl.payment, bankName: 'Banca scelta a mano', iban: 'IT00C0000000000000000000000' } });
      const noPayment = await newDraft({ payment: null });
      const toIssue = await newDraft();
      const issued = (await inject('POST', `/api/documents/${toIssue.id}/issue`)).json().document;

      const { issuer } = (await inject('GET', '/api/issuer')).json();
      const newBank = { bankName: 'Banca Nuova', iban: 'IT00A0000000000000000000000' };
      const saved = await inject('PUT', '/api/issuer', { ...issuer, payment: { ...issuer.payment, ...newBank } });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().updatedDrafts).toBe(1);

      expect(await paymentOf(followsDefault.id)).toMatchObject({ ...newBank, method: 'MP05', dueDate: followsDefault.payment.dueDate });
      expect(await paymentOf(customBank.id)).toMatchObject({ bankName: 'Banca scelta a mano' });
      expect(await paymentOf(noPayment.id)).toBeNull();
      expect(await paymentOf(issued.id)).toMatchObject({ bankName: 'Banca Esempio', iban: 'IT60X0542811101000000123456' });
      // i nuovi documenti partono già con la banca nuova
      expect((await inject('GET', '/api/documents/new')).json().payment).toMatchObject(newBank);

      // salvare di nuovo senza cambiare banca non tocca niente
      const again = await inject('PUT', '/api/issuer', { ...issuer, payment: { ...issuer.payment, ...newBank } });
      expect(again.json().updatedDrafts).toBe(0);
    } finally {
      await s.app.close();
      await fs.rm(s.dataDir, { recursive: true, force: true });
    }
  });
});

describe('numerazione e riapertura', () => {
  let s: Server;
  const year = new Date().getFullYear();
  beforeAll(async () => {
    s = await makeTestServer();
  });
  afterAll(async () => {
    await s.app.close();
    await fs.rm(s.dataDir, { recursive: true, force: true });
  });
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
    s.app.inject({ method, url, payload: payload as object | undefined });
  const numbering = async () => (await inject('GET', `/api/numbering?year=${year}`)).json();
  async function draft(overrides: Record<string, unknown> = {}, type = 'TD01') {
    const tpl = (await inject('GET', `/api/documents/new?type=${type}&customerId=esempio-software-s-r-l`)).json();
    const res = await inject('POST', '/api/documents', { ...tpl, lines: goldenLines, ...overrides });
    expect(res.statusCode).toBe(201);
    return res.json().document as { id: string };
  }
  const issue = (id: string) => inject('POST', `/api/documents/${id}/issue`);

  it('propone il prossimo numero, accetta un numero scelto e riparte da lì', async () => {
    expect((await numbering()).series.invoice).toMatchObject({ next: 1, nextNumber: '1', minNext: 1 });
    expect((await numbering()).series.proforma).toMatchObject({ next: 1, nextNumber: 'PF1' });

    // numerazione cominciata con un altro programma: prossimo numero 16
    const set = await inject('PUT', '/api/numbering', { year, next: { invoice: 16 } });
    expect(set.statusCode).toBe(200);
    expect(set.json().series.invoice).toMatchObject({ next: 16, lastUsed: 15, minNext: 1 });
    expect((await issue((await draft()).id)).json().document).toMatchObject({ number: '16', sequence: 16 });
    expect((await numbering()).series.invoice.next).toBe(17);

    // numero scelto nella bozza, conservato nei salvataggi
    const chosen = await draft({ sequence: 20 });
    expect((await inject('GET', `/api/documents/${chosen.id}`)).json().document.sequence).toBe(20);
    expect((await issue(chosen.id)).json().document.number).toBe('20');
    expect((await numbering()).series.invoice).toMatchObject({ next: 21, minNext: 21 });

    // un numero già usato si rifiuta; uno libero più basso si accetta e non abbassa il prossimo
    const taken = await issue((await draft({ sequence: 16 })).id);
    expect(taken.statusCode).toBe(409);
    expect(taken.json().message).toContain('16');
    expect((await issue((await draft({ sequence: 18 })).id)).json().document.number).toBe('18');
    expect((await numbering()).series.invoice.next).toBe(21);

    // il prossimo numero non scende sotto un documento emesso qui, ma si può correggere sopra
    expect((await inject('PUT', '/api/numbering', { year, next: { invoice: 15 } })).statusCode).toBe(409);
    expect((await inject('PUT', '/api/numbering', { year, next: { invoice: 25 } })).json().series.invoice.next).toBe(25);
    expect((await inject('PUT', '/api/numbering', { year, next: { invoice: 21 } })).json().series.invoice.next).toBe(21);

    // lo stato conserva anche il progressivo invio
    const state = await fs.readFile(path.join(s.dataDir, 'state.yaml'), 'utf8');
    expect(state).toMatch(/transmissionCounter: [1-9]/);
    expect(state).toContain('lastSequences');
  });

  it('riapre un documento emesso: torna bozza con lo stesso numero, XML e PDF nuovi', async () => {
    const issued = (await issue((await draft()).id)).json().document;
    const outDir = path.join(s.dataDir, 'output', String(year));
    await fs.access(path.join(outDir, issued.xmlFileName));
    await inject('POST', `/api/documents/${issued.id}/status`, { status: 'uploaded', sdiNotes: 'Scartata' });

    const reopened = await inject('POST', `/api/documents/${issued.id}/reopen`);
    expect(reopened.statusCode).toBe(200);
    const reopenedDraft = reopened.json();
    expect(reopenedDraft).toMatchObject({ status: 'draft', sequence: issued.sequence });
    expect(reopenedDraft.number).toBeUndefined();
    expect(reopenedDraft.xmlFileName).toBeUndefined();
    expect((await inject('GET', `/api/documents/${issued.id}`)).statusCode).toBe(404);
    await expect(fs.access(path.join(outDir, issued.xmlFileName))).rejects.toThrow();

    // corretta e riemessa: stesso numero e id, nuovo progressivo invio (nuovo nome file)
    const fixed = { ...reopenedDraft, reason: 'Causale corretta' };
    expect((await inject('PUT', `/api/documents/${reopenedDraft.id}`, fixed)).statusCode).toBe(200);
    const reissued = (await issue(reopenedDraft.id)).json().document;
    expect(reissued).toMatchObject({ id: issued.id, number: issued.number, status: 'issued', reason: 'Causale corretta' });
    expect(reissued.transmissionSequence).not.toBe(issued.transmissionSequence);
    await fs.access(path.join(outDir, reissued.xmlFileName));

    // una bozza non si riapre
    expect((await inject('POST', `/api/documents/${(await draft()).id}/reopen`)).statusCode).toBe(409);
    // con una nota di credito collegata non si riapre
    const credit = (await inject('POST', `/api/documents/${reissued.id}/credit-note`)).json();
    expect((await issue(credit.id)).statusCode).toBe(200);
    expect((await inject('POST', `/api/documents/${reissued.id}/reopen`)).statusCode).toBe(409);
  });

  it('una proforma già convertita non si riapre', async () => {
    const proforma = (await issue((await draft({}, 'proforma')).id)).json().document;
    const converted = (await inject('POST', `/api/documents/${proforma.id}/convert`)).json();
    expect(converted.status).toBe('draft');
    const res = await inject('POST', `/api/documents/${proforma.id}/reopen`);
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('convertita');
  });
});

describe('codice destinatario SDI', () => {
  it('emittente e cliente: sul PDF se ci sono, non con 0000000', async () => {
    const s = await makeTestServer();
    const inject = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) =>
      s.app.inject({ method, url, payload: payload as object | undefined });
    try {
      const { issuer } = (await inject('GET', '/api/issuer')).json();
      const saved = await inject('PUT', '/api/issuer', { ...issuer, contacts: { ...issuer.contacts, recipientCode: ' abc1234 ' } });
      expect(saved.json().issuer.contacts.recipientCode).toBe('ABC1234');
      expect(saved.json().issues).toEqual([]);

      const tpl = (await inject('GET', '/api/documents/new?customerId=esempio-software-s-r-l')).json();
      const preview = (recipientCode: string) =>
        inject('POST', '/api/preview/html', { ...tpl, lines: goldenLines, customer: { ...tpl.customer, recipientCode } });
      const withCode = (await preview('XYZ9876')).body;
      expect(withCode).toContain('Codice SDI: ABC1234');
      expect(withCode).toContain('Codice SDI: XYZ9876');
      const withoutCode = (await preview('0000000')).body;
      expect(withoutCode.match(/Codice SDI/g)).toHaveLength(1);

      const bad = await inject('PUT', '/api/issuer', { ...issuer, contacts: { ...issuer.contacts, recipientCode: 'AB' } });
      expect(bad.json().issues).toEqual([expect.objectContaining({ path: 'issuer.contacts.recipientCode', severity: 'warning' })]);
    } finally {
      await s.app.close();
      await fs.rm(s.dataDir, { recursive: true, force: true });
    }
  });
});

describe('autenticazione', () => {
  it('modalità password: 401 senza sessione, login, accesso', async () => {
    const s = await makeTestServer({
      auth: { mode: 'password', passwordHash: hashPassword('password-di-prova'), sessionSecret: 'segreto-test' },
    });
    try {
      expect((await s.app.inject({ method: 'GET', url: '/api/issuer' })).statusCode).toBe(401);
      const bad = await s.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'sbagliata' } });
      expect(bad.statusCode).toBe(401);
      // dopo un errore c'è un breve blocco: aspettiamo che scada
      await new Promise((r) => setTimeout(r, 1100));
      const ok = await s.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'password-di-prova' } });
      expect(ok.statusCode).toBe(200);
      const cookie = ok.cookies.find((c) => c.name === 'o2b_session');
      expect(cookie?.httpOnly).toBe(true);
      const authed = await s.app.inject({
        method: 'GET',
        url: '/api/issuer',
        cookies: { o2b_session: cookie!.value },
      });
      expect(authed.statusCode).toBe(200);
    } finally {
      await s.app.close();
      await fs.rm(s.dataDir, { recursive: true, force: true });
    }
  });

  it('cambio password: chiede la attuale, chiude le altre sessioni, resta dopo il riavvio', async () => {
    const auth = { mode: 'password', passwordHash: hashPassword('password-di-prova'), sessionSecret: 'segreto-test' } as const;
    const s = await makeTestServer({ auth });
    const login = (server: Server, password: string) =>
      server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } });
    const sessionOf = (res: Awaited<ReturnType<typeof login>>) =>
      res.cookies.find((c) => c.name === 'o2b_session')?.value ?? '';
    const change = (session: string | null, payload: object) =>
      s.app.inject({
        method: 'POST',
        url: '/api/auth/password',
        payload,
        cookies: session ? { o2b_session: session } : {},
      });
    const issuerWith = (session: string) =>
      s.app.inject({ method: 'GET', url: '/api/issuer', cookies: { o2b_session: session } });
    const authFile = path.join(s.dataDir, 'auth.yaml');
    try {
      const mine = sessionOf(await login(s, 'password-di-prova'));
      const otherDevice = sessionOf(await login(s, 'password-di-prova'));
      const valid = { currentPassword: 'password-di-prova', newPassword: 'nuova-password-123' };

      expect((await change(null, valid)).statusCode).toBe(401);
      const wrong = await change(mine, { ...valid, currentPassword: 'sbagliata' });
      expect(wrong.statusCode).toBe(403);
      expect(wrong.json().error).toBe('invalid_password');
      await new Promise((r) => setTimeout(r, 1100)); // fine del blocco dopo l'errore
      const short = await change(mine, { ...valid, newPassword: 'corta' });
      expect(short.statusCode).toBe(400);
      expect(short.json().error).toBe('weak_password');
      await expect(fs.access(authFile)).rejects.toThrow();

      const ok = await change(mine, valid);
      expect(ok.statusCode).toBe(200);
      // chi l'ha cambiata resta dentro con il cookie nuovo; le sessioni di prima si chiudono
      expect((await issuerWith(sessionOf(ok))).statusCode).toBe(200);
      expect((await issuerWith(mine)).statusCode).toBe(401);
      expect((await issuerWith(otherDevice)).statusCode).toBe(401);
      expect((await login(s, 'nuova-password-123')).statusCode).toBe(200);
      expect((await login(s, 'password-di-prova')).statusCode).toBe(401);

      const saved = await fs.readFile(authFile, 'utf8');
      expect(saved).toContain('scrypt$');
      expect(saved).not.toContain('nuova-password-123');
    } finally {
      await s.app.close();
    }

    try {
      // al riavvio vale la password nuova
      const restarted = await makeTestServer({ auth, dataDir: s.dataDir });
      expect((await login(restarted, 'nuova-password-123')).statusCode).toBe(200);
      await restarted.app.close();
      // password dimenticata: un nuovo O2B_PASSWORD_HASH prevale su auth.yaml
      const reset = await makeTestServer({ auth: { ...auth, passwordHash: hashPassword('password-ripristinata') }, dataDir: s.dataDir });
      expect((await login(reset, 'password-ripristinata')).statusCode).toBe(200);
      await reset.app.close();
    } finally {
      await fs.rm(s.dataDir, { recursive: true, force: true });
    }
  });

  it('senza modalità password il cambio password non è previsto', async () => {
    const s = await makeTestServer();
    try {
      const res = await s.app.inject({
        method: 'POST',
        url: '/api/auth/password',
        payload: { currentPassword: 'qualsiasi-cosa', newPassword: 'nuova-password-123' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await s.app.close();
      await fs.rm(s.dataDir, { recursive: true, force: true });
    }
  });

  it('nessun URL alternativo aggira il login (codifica, slash doppi, dot segment)', async () => {
    const s = await makeTestServer({
      auth: { mode: 'password', passwordHash: hashPassword('password-di-prova'), sessionSecret: 'segreto-test' },
    });
    try {
      const variants = [
        '/%61pi/issuer',
        '/%61%70%69/customers',
        '/api/%69ssuer',
        '//api/issuer',
        '/api//issuer',
        '/api/auth/../issuer',
        '/api/auth/%2e%2e/issuer',
        '/api/health/../issuer',
        '/api/issuer?next=/api/auth/',
        '/api/issuer#/api/health',
      ];
      for (const url of variants) {
        const res = await s.app.inject({ method: 'GET', url });
        expect({ url, status: res.statusCode }).not.toEqual({ url, status: 200 });
        expect(res.body).not.toContain('RSSMRA80A01H501U');
      }
      // le rotte pubbliche restano pubbliche
      expect((await s.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
      expect((await s.app.inject({ method: 'GET', url: '/api/health?probe=1' })).statusCode).toBe(200);
      expect((await s.app.inject({ method: 'GET', url: '/api/auth/status' })).statusCode).toBe(200);
    } finally {
      await s.app.close();
      await fs.rm(s.dataDir, { recursive: true, force: true });
    }
  });

  it('in locale rifiuta gli Host non di loopback (DNS rebinding)', async () => {
    const s = await makeTestServer();
    try {
      const evil = await s.app.inject({ method: 'GET', url: '/api/issuer', headers: { host: 'evil.example.com:3210' } });
      expect(evil.statusCode).toBe(421);
      expect(evil.body).not.toContain('RSSMRA80A01H501U');
      for (const host of ['localhost:3210', '127.0.0.1:3210', '[::1]:3210', 'LOCALHOST']) {
        const ok = await s.app.inject({ method: 'GET', url: '/api/issuer', headers: { host } });
        expect({ host, status: ok.statusCode }).toEqual({ host, status: 200 });
      }
    } finally {
      await s.app.close();
      await fs.rm(s.dataDir, { recursive: true, force: true });
    }
    // dietro un proxy pubblico (localOnly: false) l'Host è il dominio del sito
    const pub = await makeTestServer({ localOnly: false });
    try {
      const res = await pub.app.inject({ method: 'GET', url: '/api/health', headers: { host: 'fatture.example.com' } });
      expect(res.statusCode).toBe(200);
    } finally {
      await pub.app.close();
      await fs.rm(pub.dataDir, { recursive: true, force: true });
    }
  });

  it('rifiuta le modifiche richieste da un altro sito (CSRF)', async () => {
    const s = await makeTestServer();
    try {
      const customer = { kind: 'individual', firstName: 'Anna', lastName: 'Verdi', taxCode: 'BNCLRA85M41F205C' };
      const viaOrigin = await s.app.inject({
        method: 'POST',
        url: '/api/customers',
        headers: { origin: 'https://evil.example.com' },
        payload: customer,
      });
      expect(viaOrigin.statusCode).toBe(403);
      const viaFetchSite = await s.app.inject({
        method: 'POST',
        url: '/api/customers',
        headers: { 'sec-fetch-site': 'cross-site' },
        payload: customer,
      });
      expect(viaFetchSite.statusCode).toBe(403);
      const nullOrigin = await s.app.inject({ method: 'DELETE', url: '/api/customers/x', headers: { origin: 'null' } });
      expect(nullOrigin.statusCode).toBe(403);
      // le letture restano libere; la stessa origine può modificare
      const read = await s.app.inject({ method: 'GET', url: '/api/customers', headers: { origin: 'https://evil.example.com' } });
      expect(read.statusCode).toBe(200);
      // un'altra app su localhost ma su un'altra porta non è la stessa origine
      const otherPort = await s.app.inject({
        method: 'POST',
        url: '/api/customers',
        headers: { host: 'localhost:3210', origin: 'http://localhost:8080' },
        payload: customer,
      });
      expect(otherPort.statusCode).toBe(403);
      const sameSite = await s.app.inject({
        method: 'POST',
        url: '/api/customers',
        headers: { 'sec-fetch-site': 'same-site' },
        payload: customer,
      });
      expect(sameSite.statusCode).toBe(403);
      // come dal proxy di Vite: Host e Origin coincidono, porta compresa
      const sameOrigin = await s.app.inject({
        method: 'POST',
        url: '/api/customers',
        headers: { host: 'localhost:5273', origin: 'http://localhost:5273', 'sec-fetch-site': 'same-origin' },
        payload: customer,
      });
      expect(sameOrigin.statusCode).not.toBe(403);
      const defaultPort = await s.app.inject({
        method: 'POST',
        url: '/api/customers',
        headers: { host: 'localhost:80', origin: 'http://localhost' },
        payload: customer,
      });
      expect(defaultPort.statusCode).not.toBe(403);
    } finally {
      await s.app.close();
      await fs.rm(s.dataDir, { recursive: true, force: true });
    }
  });

  it('modalità token (desktop)', async () => {
    const s = await makeTestServer({ auth: { mode: 'token', token: 'abc123' } });
    try {
      expect((await s.app.inject({ method: 'GET', url: '/api/issuer' })).statusCode).toBe(401);
      const res = await s.app.inject({ method: 'GET', url: '/api/issuer', cookies: { o2b_token: 'abc123' } });
      expect(res.statusCode).toBe(200);
    } finally {
      await s.app.close();
      await fs.rm(s.dataDir, { recursive: true, force: true });
    }
  });
});
