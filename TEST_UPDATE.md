# Guida per Testare il Sistema di Aggiornamento

## Metodo 1: Test Rapido (senza pubblicare su GitHub)

### Step 1: Prepara la versione di test
1. Modifica temporaneamente `package.json` e cambia la versione a `0.1.7`
2. Compila l'app: `npm run electron:build:mac`
3. Questo creerà i file DMG e ZIP nella cartella `release/`

### Step 2: Simula la versione vecchia
1. Vai nella cartella `release/mac-arm64/Undergrain.app/Contents/`
2. Modifica il file `Info.plist` e cambia `CFBundleShortVersionString` da `0.1.7` a `0.1.6`
3. Oppure modifica il file `Info.plist` nella cartella `release/mac/Undergrain.app/Contents/` per x64

### Step 3: Esegui l'app con versione vecchia
1. Esegui l'app dalla cartella `release/mac-arm64/` (o `release/mac/`)
2. Apri la console di sviluppo (Cmd+Option+I) per vedere i log
3. Controlla che la versione mostrata sia 0.1.6

### Step 4: Testa il controllo aggiornamenti
1. Nell'app, vai su "Informazioni su Undergrain" dal menu (macOS)
2. Clicca "Verifica aggiornamenti..."
3. Oppure aspetta che l'app controlli automaticamente (controlla ogni ora)

### Step 5: Verifica il download
- Se trova l'aggiornamento 0.1.7, dovrebbe scaricarlo
- Dovresti vedere il progresso nel messaggio di stato
- Quando il download è completo, dovresti vedere: "⚠️ Aggiornamento v0.1.7 pronto! Clicca qui per installare"

### Step 6: Testa l'apertura del file
1. Clicca sul messaggio di aggiornamento
2. Dovresti vedere nella console: `[Auto-updater] Attempting to open update file: ...`
3. Il file DMG dovrebbe aprirsi automaticamente
4. Se non si apre, controlla i log nella console per vedere l'errore

## Metodo 2: Test con GitHub Releases (simulazione reale)

### Step 1: Prepara una nuova versione
1. Cambia versione a `0.1.7` in `package.json`
2. Compila: `npm run electron:build:mac`
3. Crea una release DRAFT su GitHub con tag `v0.1.7`
4. Carica manualmente i file DMG nella release (non pubblicarla ancora)

### Step 2: Installa la versione vecchia
1. Installa l'app versione 0.1.6 dal DMG esistente
2. Esegui l'app installata

### Step 3: Testa
1. L'app dovrebbe rilevare automaticamente la nuova versione
2. Segui i passi del Metodo 1

## Verifica Log

Apri la console di Electron (Cmd+Option+I) e controlla i log:
- `[Auto-updater] Update downloaded: 0.1.7`
- `[Auto-updater] Update file path: /path/to/file.dmg`
- `[Auto-updater] Update file exists and is accessible`
- `[Auto-updater] Successfully opened update file`

Se ci sono errori, li vedrai nella console con prefisso `[Auto-updater]`.

## Note Importanti

- L'app controlla automaticamente gli aggiornamenti all'avvio e ogni ora
- In modalità sviluppo (NODE_ENV=development) gli aggiornamenti sono disabilitati
- Se l'app non è code-signed, il riavvio automatico non funziona (come previsto)
- Il file DMG viene aperto manualmente per l'installazione


