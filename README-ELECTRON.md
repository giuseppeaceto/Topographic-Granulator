# Undergrain - Desktop App Setup

Questo progetto è stato configurato per funzionare come applicazione desktop cross-platform usando Electron.

## 🚀 Installazione Dipendenze

Prima di tutto, installa le dipendenze necessarie:

```bash
npm install
```

Se ci sono problemi con il registry npm, puoi provare:
```bash
npm install --registry https://registry.npmjs.org/
```

## 📦 Script Disponibili

### Sviluppo
- `npm run dev` - Avvia Vite dev server (per sviluppo web)
- `npm run electron:dev` - Avvia l'app Electron in modalità sviluppo

### Build
- `npm run build` - Costruisce l'applicazione web
- `npm run electron:build` - Costruisce l'app Electron per la piattaforma corrente
- `npm run electron:build:mac` - Build per macOS
- `npm run electron:build:win` - Build per Windows
- `npm run electron:build:linux` - Build per Linux
- `npm run electron:build:all` - Build per tutte le piattaforme

## 🔄 Aggiornamenti Automatici

L'app è configurata con `electron-updater` per gli aggiornamenti automatici. 

### Configurazione GitHub Releases

Per abilitare gli aggiornamenti automatici tramite GitHub Releases:

1. Vai su GitHub e crea un repository (se non l'hai già fatto)
2. Aggiorna `package.json` nella sezione `build.publish`:
   ```json
   "publish": {
     "provider": "github",
     "owner": "tuo-username-github",
     "repo": "Topographic-Granulator"
   }
   ```

3. Crea un GitHub Personal Access Token con permessi `repo`
4. Configura il token come variabile d'ambiente:
   ```bash
   export GH_TOKEN=your_token_here
   ```

5. Quando pubblichi una release, electron-builder caricherà automaticamente i file

### Come Funzionano gli Aggiornamenti

- L'app controlla automaticamente gli aggiornamenti all'avvio
- Controlla ogni ora se ci sono nuovi aggiornamenti
- Quando trova un aggiornamento, lo scarica in background
- Al prossimo riavvio, l'app si aggiornerà automaticamente

## 🎨 Icone e Assets

Crea le icone per l'app nella cartella `build/`:
- `icon.icns` - macOS (512x512 o superiore)
- `icon.ico` - Windows (256x256 con multiple sizes)
- `icon.png` - Linux (512x512)

Puoi usare strumenti come:
- [Electron Icon Maker](https://www.electron.build/icons)
- [Icon Generator](https://icon.kitchen/)

## 🔧 Configurazione Vite per Electron

Il file `vite.config.ts` è configurato per usare path relativi (`base: './'`), necessario per Electron.

## 📝 Note Importanti

1. **Web Audio API**: Funziona perfettamente in Electron
2. **MIDI**: Richiede permessi appropriati (funziona come nel browser)
3. **Screen Recording**: Funziona con `getDisplayMedia()` in Electron
4. **File System**: Puoi usare le API Electron per operazioni avanzate sul file system

## 🐛 Troubleshooting

### L'app non si avvia
- Assicurati di aver eseguito `npm run build` prima di `npm run electron:dev`
- Controlla che tutte le dipendenze siano installate

### Gli aggiornamenti non funzionano
- Verifica la configurazione GitHub nel `package.json`
- Assicurati che il token GitHub sia configurato correttamente
- Controlla che le release su GitHub abbiano i file corretti

### Problemi con Web Audio
- Electron supporta Web Audio API nativamente
- Se ci sono problemi, verifica che `webPreferences.enableBlinkFeatures` includa 'WebAudio'

## 📚 Risorse

- [Electron Documentation](https://www.electronjs.org/docs)
- [electron-builder Documentation](https://www.electron.build/)
- [electron-updater Documentation](https://www.electron.build/auto-update)

