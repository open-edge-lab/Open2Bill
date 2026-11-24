// Ponte verso l'app desktop (definito dal preload di Electron). Assente nel browser.

export interface DesktopBridge {
  isDesktop: true;
  /** Mostra un file della cartella output (es. "2026/ITxxx_00001.xml") in Esplora risorse. */
  revealOutput(relativePath: string): Promise<void>;
  /** Apre la cartella dati. */
  openDataDir(): Promise<void>;
  /** Sceglie una nuova cartella dati e riavvia il server interno. */
  chooseDataDir(): Promise<string | null>;
}

declare global {
  interface Window {
    open2bill?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | undefined = typeof window !== 'undefined' ? window.open2bill : undefined;
