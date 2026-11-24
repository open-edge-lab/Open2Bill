import { contextBridge, ipcRenderer } from 'electron';

// Funzioni esposte alla UI (window.open2bill). Solo operazioni sui file locali:
// tutto il resto passa dall'API HTTP del server interno.

contextBridge.exposeInMainWorld('open2bill', {
  isDesktop: true,
  revealOutput: (relativePath: string) => ipcRenderer.invoke('o2b:reveal-output', relativePath),
  openDataDir: () => ipcRenderer.invoke('o2b:open-data-dir'),
  chooseDataDir: () => ipcRenderer.invoke('o2b:choose-data-dir'),
});
