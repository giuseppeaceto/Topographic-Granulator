# Test Rapido Sistema Aggiornamento

## Passi per Testare

### 1. Crea una nuova versione di test
```bash
# Modifica package.json: cambia versione da 0.1.6 a 0.1.7
# Poi compila
npm run electron:build:mac
```

### 2. Pubblica su GitHub (DRAFT)
1. Vai su GitHub: https://github.com/GiuseppeAceto/Topographic-Granulator/releases/new
2. Crea una nuova release DRAFT con tag `v0.1.7`
3. Carica i file DMG dalla cartella `release/`:
   - `Undergrain-0.1.7.dmg` (x64)
   - `Undergrain-0.1.7-arm64.dmg` (arm64)
   - `latest-mac.yml` (se presente)
4. NON pubblicare ancora, lascia come DRAFT

### 3. Installa e testa con versione vecchia
1. Installa l'app versione 0.1.6 (dal DMG esistente o compila con versione 0.1.6)
2. Esegui l'app installata
3. Apri la console di sviluppo: Cmd+Option+I (macOS)
4. Vai nel menu: "Informazioni su Undergrain" > "Verifica aggiornamenti..."
5. Oppure aspetta il controllo automatico (ogni ora)

### 4. Verifica il comportamento
- L'app dovrebbe trovare la versione 0.1.7
- Dovrebbe scaricarla automaticamente
- Quando il download è completo, vedrai: "⚠️ Aggiornamento v0.1.7 pronto! Clicca qui per installare"
- Clicca sul messaggio
- Controlla la console per i log `[Auto-updater]`
- Il file DMG dovrebbe aprirsi

### 5. Verifica i log nella console
Cerca questi messaggi nella console:
```
[Auto-updater] Update downloaded: 0.1.7
[Auto-updater] Update file path: /path/to/file.dmg
[Auto-updater] Update file exists and is accessible
[Auto-updater] Successfully opened update file
```

Se vedi errori, controlla cosa dice il log.

### 6. Cleanup
Dopo il test, elimina la release DRAFT su GitHub se non la vuoi pubblicare.

## Test Locale (Alternativa)

Se non vuoi pubblicare su GitHub, puoi configurare un server locale, ma è più complesso. 
Il metodo GitHub DRAFT è il più semplice e simula il comportamento reale.


