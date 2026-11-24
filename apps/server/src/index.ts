// API del pacchetto server, usata anche dall'app desktop (Electron).
export { createServer, DEFAULT_ASSETS_DIR, type Open2BillServer, type ServerOptions } from './app';
export { DESKTOP_COOKIE, hashPassword, verifyPassword, type AuthConfig } from './auth';
export { defaultDataDir, loadConfig } from './config';
export type { PdfEngine } from './pdf/engine';
export { PuppeteerPdfEngine, findBrowserExecutable } from './pdf/puppeteer-engine';
