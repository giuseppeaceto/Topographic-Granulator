/**
 * Update Manager - Gestisce gli aggiornamenti automatici dell'app Electron
 */
export function createUpdateManager() {
  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

  if (!isElectron) {
    return {
      checkForUpdates: () => Promise.resolve(false),
      onUpdateAvailable: () => {},
      onDownloadProgress: () => {},
      onUpdateDownloaded: () => {},
    };
  }

  const electronAPI = (window as any).electronAPI;

  function checkForUpdates(): Promise<boolean> {
    // Updates are checked automatically by Electron main process
    // This is just a placeholder for manual checks if needed
    return Promise.resolve(true);
  }

  function onUpdateAvailable(callback: (info: any) => void) {
    if (electronAPI?.onUpdateAvailable) {
      electronAPI.onUpdateAvailable(callback);
    }
  }

  function onDownloadProgress(callback: (progress: any) => void) {
    if (electronAPI?.onDownloadProgress) {
      electronAPI.onDownloadProgress(callback);
    }
  }

  function onUpdateDownloaded(callback: (info: any) => void) {
    if (electronAPI?.onUpdateDownloaded) {
      electronAPI.onUpdateDownloaded(callback);
    }
  }

  function onCheckingForUpdateManual(callback: () => void) {
    if (electronAPI?.onCheckingForUpdateManual) {
      electronAPI.onCheckingForUpdateManual(callback);
    }
  }

  function onUpdateNotAvailable(callback: (info: any) => void) {
    if (electronAPI?.onUpdateNotAvailable) {
      electronAPI.onUpdateNotAvailable(callback);
    }
  }

  function onUpdateError(callback: (error: any) => void) {
    if (electronAPI?.onUpdateError) {
      electronAPI.onUpdateError(callback);
    }
  }

  return {
    checkForUpdates,
    onUpdateAvailable,
    onDownloadProgress,
    onUpdateDownloaded,
    onCheckingForUpdateManual,
    onUpdateNotAvailable,
    onUpdateError,
  };
}

