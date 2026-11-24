import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { createServer, DESKTOP_COOKIE, type Open2BillServer } from '@open2bill/server';
import { ElectronPdfEngine } from './pdf-engine';

// App desktop: avvia il server Open2Bill in-process su 127.0.0.1 (porta casuale)
// e apre la UI in una finestra. L'API è protetta da un token casuale per sessione,
// passato come cookie: altre app o siti non possono usarla.

const here = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

/** Cartelle di UI e asset: nel pacchetto stanno in resources/, in sviluppo nel monorepo. */
const webDir = isDev ? path.resolve(here, '..', '..', 'web', 'dist') : path.join(process.resourcesPath, 'web');
const assetsDir = isDev ? path.resolve(here, '..', '..', 'server', 'assets') : path.join(process.resourcesPath, 'assets');

// ── Configurazione (cartella dati scelta dall'utente) ─────────
const configFile = () => path.join(app.getPath('userData'), 'config.json');

function readDataDir(): string {
  // per sviluppo e test: cartella dati esplicita
  if (process.env.O2B_DATA_DIR) return path.resolve(process.env.O2B_DATA_DIR);
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8')) as { dataDir?: string };
    if (cfg.dataDir) return cfg.dataDir;
  } catch {
    // primo avvio
  }
  return path.join(app.getPath('documents'), 'Open2Bill');
}

function writeDataDir(dataDir: string) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify({ dataDir }, null, 2));
}

// ── Server interno ───────────────────────────────────────────
let server: Open2BillServer | null = null;
let serverUrl = '';
let dataDir = '';
let mainWindow: BrowserWindow | null = null;

async function startServer() {
  dataDir = readDataDir();
  const token = crypto.randomBytes(32).toString('base64url');
  server = await createServer({
    dataDir,
    assetsDir,
    webDir,
    pdfEngine: new ElectronPdfEngine(),
    auth: { mode: 'token', token },
    desktop: true,
    version: app.getVersion(),
  });
  await server.app.listen({ host: '127.0.0.1', port: 0 });
  const address = server.app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  serverUrl = `http://127.0.0.1:${port}`;
  await session.defaultSession.cookies.set({
    url: serverUrl,
    name: DESKTOP_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'strict',
  });
}

async function stopServer() {
  if (server) {
    await server.app.close();
    server = null;
  }
}

// ── Finestra ─────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'Open2Bill',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // I link esterni (es. portale Fatture e Corrispettivi) si aprono nel browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(serverUrl)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(serverUrl)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });

  void mainWindow.loadURL(serverUrl);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC ──────────────────────────────────────────────────────
ipcMain.handle('o2b:reveal-output', (_event, relativePath: unknown) => {
  if (typeof relativePath !== 'string') return;
  const outputRoot = path.resolve(dataDir, 'output');
  const target = path.resolve(outputRoot, relativePath);
  if (!target.startsWith(outputRoot + path.sep)) return;
  shell.showItemInFolder(target);
});

ipcMain.handle('o2b:open-data-dir', () => shell.openPath(dataDir));

ipcMain.handle('o2b:choose-data-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Scegli la cartella dati di Open2Bill',
    defaultPath: dataDir,
    properties: ['openDirectory', 'createDirectory'],
  });
  const chosen = result.filePaths[0];
  if (result.canceled || !chosen) return null;
  writeDataDir(chosen);
  await stopServer();
  await startServer();
  await mainWindow?.loadURL(serverUrl);
  return chosen;
});

// ── Ciclo di vita ────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await startServer();
      createWindow();
    } catch (err) {
      dialog.showErrorBox('Open2Bill non si avvia', err instanceof Error ? err.message : String(err));
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    void stopServer().finally(() => app.quit());
  });
}
