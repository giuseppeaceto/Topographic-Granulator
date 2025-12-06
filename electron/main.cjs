const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer, screen } = require('electron');
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
    icon: path.join(__dirname, '../public/images/logo.png'),
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
    
    // Focus window
    if (isDev) {
      mainWindow.focus();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
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

// Auto-updater configuration
if (!isDev) {
  autoUpdater.checkForUpdatesAndNotify();

  // Check for updates every hour
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 3600000); // 1 hour

  // Auto-updater events
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    // Optionally show notification to user
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available:', info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('Error in auto-updater:', err);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
    // Auto-install on quit (or prompt user)
    autoUpdater.quitAndInstall(false, true);
  });
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

// Handle app protocol for deep linking (optional)
app.setAsDefaultProtocolClient('undergrain');

