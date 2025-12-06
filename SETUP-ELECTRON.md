# 🚀 Setup App Desktop - Guida Completa

## ✅ Cosa è stato fatto

Ho configurato il tuo progetto **Undergrain** per funzionare come applicazione desktop cross-platform usando **Electron**. Ecco cosa è stato implementato:

### 📁 File Creati/Modificati

1. **`electron/main.js`** - Processo principale Electron
   - Gestisce la finestra dell'applicazione
   - Configura auto-updater
   - Gestisce eventi dell'app

2. **`electron/preload.js`** - Bridge sicuro tra Electron e l'app web
   - Espone API Electron in modo sicuro
   - Supporta operazioni file avanzate (opzionali)

3. **`src/modules/utils/updateManager.ts`** - Gestore aggiornamenti
   - Interfaccia per controllare aggiornamenti
   - Notifiche all'utente

4. **`vite.config.ts`** - Configurazione Vite per Electron
   - Path relativi per funzionare offline
   - Build ottimizzato

5. **`package.json`** - Aggiornato con:
   - Script per build Electron
   - Configurazione electron-builder
   - Supporto per Mac, Windows, Linux

6. **`build/entitlements.mac.plist`** - Permessi macOS
   - Audio input/output
   - Microfono

## 📦 Prossimi Passi

### 1. Installare Dipendenze

```bash
npm install
```

Se ci sono problemi con npm, prova:
```bash
npm install --legacy-peer-deps
```

Oppure installa manualmente:
```bash
npm install --save-dev electron electron-builder electron-updater
```

### 2. Testare in Sviluppo

```bash
# Prima builda l'app web
npm run build

# Poi avvia Electron
npm run electron:dev
```

### 3. Creare le Icone

Crea le icone nella cartella `build/`:
- **macOS**: `icon.icns` (512x512 o superiore)
- **Windows**: `icon.ico` (256x256 con multiple sizes)
- **Linux**: `icon.png` (512x512)

Strumenti utili:
- [Electron Icon Maker](https://www.electron.build/icons)
- [CloudConvert](https://cloudconvert.com/) per conversioni

### 4. Configurare GitHub per Aggiornamenti (Opzionale)

Se vuoi gli aggiornamenti automatici via GitHub:

1. Modifica `package.json` nella sezione `build.publish`:
```json
"publish": {
  "provider": "github",
  "owner": "tuo-username",
  "repo": "Topographic-Granulator"
}
```

2. Crea un GitHub Personal Access Token con permessi `repo`

3. Configura il token:
```bash
export GH_TOKEN=your_token_here
```

4. Quando pubblichi una release, electron-builder caricherà automaticamente i file

## 🎯 Funzionalità Supportate

✅ **Web Audio API** - Funziona perfettamente in Electron  
✅ **AudioWorklet** - Supportato nativamente  
✅ **MIDI** - Funziona come nel browser  
✅ **Screen Recording** - `getDisplayMedia()` funziona  
✅ **File System** - Accesso completo ai file  
✅ **Aggiornamenti Automatici** - Configurato con electron-updater  

## 🔧 Comandi Disponibili

### Sviluppo
```bash
npm run dev              # Vite dev server (web)
npm run electron:dev     # Electron in sviluppo
```

### Build
```bash
npm run build                    # Build web app
npm run electron:build           # Build per piattaforma corrente
npm run electron:build:mac       # Build macOS
npm run electron:build:win       # Build Windows
npm run electron:build:linux      # Build Linux
npm run electron:build:all       # Build tutte le piattaforme
```

## 📱 Come Funzionano gli Aggiornamenti

1. **Automatico**: L'app controlla aggiornamenti all'avvio e ogni ora
2. **Background**: Gli aggiornamenti si scaricano in background
3. **Notifiche**: L'utente viene notificato quando un aggiornamento è disponibile
4. **Installazione**: Al prossimo riavvio, l'app si aggiorna automaticamente

## 🐛 Troubleshooting

### L'app non si avvia
- Assicurati di aver eseguito `npm run build` prima
- Controlla che tutte le dipendenze siano installate
- Verifica i log nella console

### Web Audio non funziona
- Electron supporta Web Audio nativamente
- Se ci sono problemi, verifica i permessi audio nel sistema

### MIDI non funziona
- Su macOS, potrebbe essere necessario abilitare i permessi in System Preferences
- Su Windows/Linux, verifica i driver MIDI

### Aggiornamenti non funzionano
- Verifica la configurazione GitHub in `package.json`
- Assicurati che il token GitHub sia configurato
- Controlla che le release su GitHub abbiano i file corretti

## 📚 Risorse Utili

- [Electron Docs](https://www.electronjs.org/docs)
- [electron-builder Docs](https://www.electron.build/)
- [electron-updater Docs](https://www.electron.build/auto-update)

## 💡 Note Importanti

1. **Offline First**: L'app funziona completamente offline
2. **Aggiornamenti Opzionali**: Gli aggiornamenti richiedono connessione, ma l'app funziona senza
3. **Cross-Platform**: Una volta configurato, puoi buildare per tutte le piattaforme
4. **Performance**: Electron aggiunge ~100-150MB al bundle, ma offre accesso completo al sistema

## 🎉 Pronto!

Il progetto è configurato e pronto per diventare un'app desktop. Installa le dipendenze e inizia a testare!

