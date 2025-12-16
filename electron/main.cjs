const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer, screen, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Work around Chromium audio decode crashes seen on macOS 12 with Electron 28
// (renderer would die during AudioContext.decodeAudioData for certain files).
// Disabling the audio service sandbox keeps the renderer alive while we investigate.
app.commandLine.appendSwitch('disable-features', 'AudioServiceSandbox,AudioServiceOutOfProcess');

// Keep a global reference of the window object
let mainWindow;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    resizable: false, // User cannot resize
    fullscreenable: true, // Allow fullscreen if needed, but start fixed
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true, // Keep enabled for security, but allow local resources
      // Web Audio API is enabled by default in Electron
      // Note: Security warnings in dev mode are expected and won't appear in production
    },
    icon: path.join(__dirname, '../public/icons/icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false, // Don't show until ready
  });

  // Load the app
  if (isDev) {
    // In development, ensure the dev server is reachable before loading
    const fs = require('fs');
    const distPath = path.join(__dirname, '../dist/index.html');

    const tryLoadDev = async () => {
      try {
        // Simple ping to dev server
        const res = await fetch('http://localhost:5173/', { method: 'GET' });
        if (!res.ok) throw new Error(`Dev server responded ${res.status}`);
        await mainWindow.loadURL('http://localhost:5173');
        return true;
      } catch (err) {
        console.error('Failed to load from dev server:', err);
        return false;
      }
    };

    const tryLoadDist = () => {
      if (fs.existsSync(distPath)) {
        console.log('Loading from dist folder instead...');
        mainWindow.loadFile(distPath);
        return true;
      } else {
        console.error('No dist build found. Run "npm run build" first.');
        return false;
      }
    };

    // First attempt dev server; if it fails, try dist
    tryLoadDev().then((ok) => {
      if (!ok) {
        const loaded = tryLoadDist();
        if (!loaded) {
          mainWindow.webContents.executeJavaScript(
            'document.body.innerHTML = "<h2 style=\'color:red;font-family:sans-serif;\'>Dev server non raggiungibile e build non trovata.<br/>Avvia prima \'npm run dev\' oppure esegui \'npm run build\'.</h2>";'
          );
        }
      }
    });

    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  
  // Handle navigation errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', errorCode, errorDescription, validatedURL);
    if (isDev && validatedURL === 'http://localhost:5173/') {
      console.log('Make sure Vite dev server is running: npm run dev');
    }
  });

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Check for beta expiration (soft expiration - warning only)
    if (!isDev && (process.env.BETA === 'true' || app.getVersion().includes('beta'))) {
      checkBetaExpiration();
    }
    
    // Focus window
    if (isDev) {
      mainWindow.focus();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Soft expiration check for beta versions (warning only, doesn't block)
  function checkBetaExpiration() {
    // Use build date or app creation time as start date
    const betaStartDate = app.getCreationTime ? new Date(app.getCreationTime()) : new Date();
    const expirationDays = parseInt(process.env.BETA_EXPIRATION_DAYS || '90', 10); // Default 90 days
    const expirationDate = new Date(betaStartDate.getTime() + expirationDays * 24 * 60 * 60 * 1000);
    const daysRemaining = Math.ceil((expirationDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    
    if (daysRemaining <= 30 && daysRemaining > 0) {
      // Show warning if less than 30 days remaining
      if (mainWindow) {
        mainWindow.webContents.send('beta-expiration-warning', {
          daysRemaining,
          expirationDate: expirationDate.toISOString()
        });
      }
    } else if (daysRemaining <= 0) {
      // Show info if expired (but don't block)
      if (mainWindow) {
        mainWindow.webContents.send('beta-expiration-info', {
          daysRemaining: 0,
          expirationDate: expirationDate.toISOString()
        });
      }
    }
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Store the downloaded update path for manual installation if needed (outside dev check)
let downloadedUpdatePath = null;

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Create application menu
  createMenu();
  
  // Handle getDisplayMedia requests (required for video recording)
  // This is crucial even if we use getDesktopSources + getUserMedia, because
  // if that fails, we fallback to getDisplayMedia, which needs this handler to work in Electron.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      // Grant access to the first screen available
      const source = sources[0];
      if (source) {
        // Respect the request for audio
        if (request.audio) {
            // NOTE: Audio 'loopback' capture on macOS requires specific permission/setup and might fail if not available.
            // If it fails, it throws AbortError in renderer.
            // We try to honor the request.
            callback({ video: source, audio: 'loopback' });
        } else {
            callback({ video: source });
        }
      } else {
        // No screen source found
        callback(null);
      }
    }).catch((error) => {
      console.error(error);
      callback(null);
    });
  });

  createWindow();
  
  // Recreate menu when window is created (in case it's recreated)
  app.on('browser-window-created', () => {
    createMenu();
  });

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Function to manually check for updates
function checkForUpdatesManually() {
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify();
    // Show feedback to user
    if (mainWindow) {
      mainWindow.webContents.send('checking-for-update-manual');
    }
  }
}

// Auto-updater configuration
if (!isDev) {
  // Check if this is a beta version (version contains 'beta' or channel is set)
  const isBeta = process.env.BETA === 'true' || app.getVersion().includes('beta');
  const currentVersion = app.getVersion();
  console.log(`[Auto-updater] Current app version: ${currentVersion}`);
  console.log(`[Auto-updater] Is beta: ${isBeta}`);
  
  if (isBeta) {
    autoUpdater.channel = 'beta';
    console.log('[Auto-updater] Channel set to: beta');
  } else {
    console.log('[Auto-updater] Channel: default (stable releases)');
  }
  
  // Note: On macOS, if app is not code-signed, quitAndInstall will fail
  // We handle this in the restart-and-install-update IPC handler by opening the DMG manually
  
  autoUpdater.checkForUpdatesAndNotify();

  // Check for updates every hour
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 3600000); // 1 hour

  // Auto-updater events
  autoUpdater.on('checking-for-update', () => {
    console.log('[Auto-updater] Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    // Optionally show notification to user
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Auto-updater] Update not available. Current version:', info.version || currentVersion);
    // Notify user that they have the latest version
    if (mainWindow) {
      mainWindow.webContents.send('update-not-available', info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[Auto-updater] Error:', err);
    console.error('[Auto-updater] Error details:', {
      message: err?.message,
      code: err?.code,
      errno: err?.errno,
      stack: err?.stack,
      fullError: err
    });
    
    // Check if error is related to code signature
    const isSignatureError = err?.message && (
      err.message.includes('code signature') || 
      err.message.includes('Could not get code signature')
    );
    
    // Show error to user for debugging
    if (mainWindow) {
      mainWindow.webContents.send('update-error', {
        message: err?.message || String(err),
        code: err?.code || err?.errno,
        stack: err?.stack,
        fullError: err,
        isSignatureError: isSignatureError,
        requiresManualInstall: isSignatureError
      });
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Auto-updater] Update downloaded:', info.version);
    console.log('[Auto-updater] Update info:', JSON.stringify(info, null, 2));
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
    // Don't auto-install, let user choose when to restart
    // The update will be installed when user chooses to restart via IPC
    // Store the downloaded file path for manual installation if needed
    //
    // NOTE: With recent electron-updater versions the property is `downloadedFile`,
    // while older code sometimes used `path`. We support both to be safe.
    const downloadedFilePath = info.downloadedFile || info.path;
    if (downloadedFilePath) {
      downloadedUpdatePath = downloadedFilePath;
      console.log('[Auto-updater] Update file path:', downloadedFilePath);
      // Verify file exists
      const fs = require('fs');
      if (fs.existsSync(downloadedFilePath)) {
        console.log('[Auto-updater] Update file exists and is accessible');
      } else {
        console.error('[Auto-updater] Update file path does not exist:', downloadedFilePath);
      }
    } else {
      console.warn('[Auto-updater] No downloadedFile/path in update info; manual install may be required from GitHub release page');
    }
  });
}

// IPC handler for restart and install (defined outside dev check so it's always available)
ipcMain.handle('restart-and-install-update', async (event) => {
  if (isDev) {
    return { success: false, message: 'Updates not available in development mode' };
  }
  
  console.log('[Auto-updater] User requested restart to install update');
  
  // Check if an update is actually downloaded
  if (!downloadedUpdatePath) {
    console.error('[Auto-updater] No downloaded update path available');
    if (mainWindow) {
      mainWindow.webContents.send('update-install-error', {
        message: 'No update found. Restart the app to check for updates.',
        requiresManualInstall: true
      });
    }
    return { success: false, requiresManualInstall: true, message: 'No update downloaded' };
  }
  
  // Since the app is not code-signed and distributed manually,
  // quitAndInstall won't work reliably on macOS. Instead, we'll:
  // 1. Try to open the DMG if on macOS
  // 2. Show a clear message to manually restart the app
  
  if (process.platform === 'darwin') {
    // On macOS, try to open the DMG file for manual installation
    const { shell } = require('electron');
    const fs = require('fs');
    const path = require('path');
    
    console.log('[Auto-updater] Attempting to open update file:', downloadedUpdatePath);
    
    // Verify file exists
    if (!downloadedUpdatePath || !fs.existsSync(downloadedUpdatePath)) {
      console.error('[Auto-updater] Update file does not exist:', downloadedUpdatePath);
      if (mainWindow) {
        mainWindow.webContents.send('update-install-error', {
          message: 'Update ready! Download from GitHub and install manually, then restart.',
          requiresManualInstall: true
        });
      }
      return { success: false, requiresManualInstall: true, message: 'Update file not found' };
    }
    
    try {
      // Use shell.openPath which returns a promise that resolves with an error string if it fails
      const error = await shell.openPath(downloadedUpdatePath);
      if (error) {
        // shell.openPath returns an error string if it fails, empty string if success
        console.error('[Auto-updater] Failed to open file:', error);
        // Try opening the directory containing the file instead
        const fileDir = path.dirname(downloadedUpdatePath);
        console.log('[Auto-updater] Trying to open directory instead:', fileDir);
        const dirError = await shell.openPath(fileDir);
        if (dirError) {
          console.error('[Auto-updater] Failed to open directory:', dirError);
          throw new Error(`Cannot open file or directory: ${error}`);
        } else {
          console.log('[Auto-updater] Opened directory containing update file');
          if (mainWindow) {
            mainWindow.webContents.send('update-install-error', {
              message: 'Update folder opened. Install the app, then restart.',
              requiresManualInstall: true,
              dmgOpened: false
            });
          }
          return { success: false, requiresManualInstall: true, message: 'Directory opened' };
        }
      } else {
        console.log('[Auto-updater] Successfully opened update file');
        if (mainWindow) {
          mainWindow.webContents.send('update-install-error', {
            message: 'Update ready! Installer opened. Install the app, then restart.',
            requiresManualInstall: true,
            dmgOpened: true
          });
        }
        return { success: false, requiresManualInstall: true, message: 'File opened successfully' };
      }
    } catch (openError) {
      console.error('[Auto-updater] Error opening file:', openError);
      if (mainWindow) {
        mainWindow.webContents.send('update-install-error', {
          message: 'Update ready! Restart the app to complete installation.',
          requiresManualInstall: true
        });
      }
      return { success: false, requiresManualInstall: true, message: 'Failed to open file' };
    }
  } else {
    // On Windows/Linux, try quitAndInstall but it may not work without code signing
    try {
      autoUpdater.quitAndInstall(false, false);
      // Give it a moment - if it doesn't work, user will need to restart manually
      return { success: true, message: 'Restarting...' };
    } catch (error) {
      console.error('[Auto-updater] Error calling quitAndInstall:', error);
      if (mainWindow) {
        mainWindow.webContents.send('update-install-error', {
          message: 'Update ready! Restart the app to complete installation.',
          requiresManualInstall: true
        });
      }
      return { success: false, requiresManualInstall: true, message: 'Manual restart required' };
    }
  }
});

// Create application menu
function createMenu() {
  const template = [];

  // macOS: App menu (first menu)
  if (process.platform === 'darwin') {
    template.push({
      label: app.getName(),
      submenu: [
        {
          label: `About ${app.getName()}`,
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: `About ${app.getName()}`,
              message: app.getName(),
              detail: `Version ${app.getVersion()}\n\nTopographic Granulator - Desktop Audio Application\n\nStudio: Infrared Dreams\nCreator: Giuseppe Aceto`,
              buttons: ['OK']
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Verifica aggiornamenti...',
          click: () => checkForUpdatesManually(),
          enabled: !isDev
        },
        { type: 'separator' },
        { role: 'services', label: 'Servizi' },
        { type: 'separator' },
        { role: 'hide', label: 'Nascondi ' + app.getName() },
        { role: 'hideothers', label: 'Nascondi altre' },
        { role: 'unhide', label: 'Mostra tutto' },
        { type: 'separator' },
        { role: 'quit', label: 'Esci da ' + app.getName() }
      ]
    });
  }

  // File menu
  template.push({
    label: 'File',
    submenu: [
      { role: 'close', label: 'Chiudi finestra' }
    ]
  });

  // Edit menu
  template.push({
    label: 'Modifica',
    submenu: [
      { role: 'undo', label: 'Annulla' },
      { role: 'redo', label: 'Ripeti' },
      { type: 'separator' },
      { role: 'cut', label: 'Taglia' },
      { role: 'copy', label: 'Copia' },
      { role: 'paste', label: 'Incolla' },
      { role: 'selectall', label: 'Seleziona tutto' }
    ]
  });

  // View menu
  const viewMenu = {
    label: 'Visualizza',
    submenu: [
      { role: 'reload', label: 'Ricarica' },
      { role: 'forceReload', label: 'Forza ricarica' }
    ]
  };
  
  // Only show DevTools in development mode
  if (isDev) {
    viewMenu.submenu.push({ role: 'toggleDevTools', label: 'Strumenti sviluppatore' });
  }
  
  viewMenu.submenu.push(
    { type: 'separator' },
    { role: 'resetZoom', label: 'Zoom reale' },
    { role: 'zoomIn', label: 'Ingrandisci' },
    { role: 'zoomOut', label: 'Riduci' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: 'Schermo intero' }
  );
  
  template.push(viewMenu);

  // Window menu (macOS)
  if (process.platform === 'darwin') {
    template.push({
      label: 'Finestra',
      submenu: [
        { role: 'minimize', label: 'Riduci a icona' },
        { role: 'close', label: 'Chiudi' },
        { type: 'separator' },
        { role: 'front', label: 'Porta tutto in primo piano' }
      ]
    });
  }

  // Help menu (Windows/Linux) or separate Help (macOS)
  const helpMenu = {
    label: 'Aiuto',
    submenu: [
      {
        label: 'Verifica aggiornamenti...',
        click: () => checkForUpdatesManually(),
        enabled: !isDev
      }
    ]
  };

  if (process.platform === 'darwin') {
    // On macOS, add About to Help menu
    helpMenu.submenu.unshift({
      label: `Informazioni su ${app.getName()}`,
      click: () => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: `Informazioni su ${app.getName()}`,
          message: app.getName(),
          detail: `Versione ${app.getVersion()}\n\nTopographic Granulator - Desktop Audio Application\n\nStudio: Infrared Dreams\nIdeatore: Giuseppe Aceto`,
          buttons: ['OK']
        });
      }
    });
  } else {
    // On Windows/Linux, add About to Help menu
    helpMenu.submenu.unshift({
      label: `About ${app.getName()}`,
      click: () => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: `About ${app.getName()}`,
          message: app.getName(),
          detail: `Version ${app.getVersion()}\n\nTopographic Granulator - Desktop Audio Application\n\nStudio: Infrared Dreams\nCreator: Giuseppe Aceto`,
          buttons: ['OK']
        });
      }
    });
  }

  template.push(helpMenu);

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}


// IPC handlers for file operations (optional - can enhance file picker)
ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    ...options,
    properties: ['openFile'],
  });
  return result;
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

ipcMain.handle('get-desktop-sources', async (event) => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  // Serialize sources to avoid "object could not be cloned" error if any
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL()
  }));
});

ipcMain.handle('get-app-version', async (event) => {
  return app.getVersion();
});

// Handle app protocol for deep linking (optional)
app.setAsDefaultProtocolClient('undergrain');

