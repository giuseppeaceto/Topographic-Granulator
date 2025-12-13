# Debug Auto-Update

## Perché l'auto-update non funziona?

### 1. Verifica la versione

**electron-updater confronta le versioni semantiche:**
- Se l'app installata è `0.1.0` e la release su GitHub è `0.1.0` → ❌ Non trova aggiornamento
- Se l'app installata è `0.1.0` e la release su GitHub è `0.1.1` → ✅ Trova aggiornamento

**Soluzione:**
```bash
# Modifica package.json
"version": "0.1.1"  # incrementa la versione

# Pubblica nuova release
npm run electron:publish
```

### 2. Verifica il canale

**Problema comune:**
- App installata = build normale → cerca solo release normali
- Release su GitHub = pre-release → ❌ Non la trova

**Soluzioni:**
- Opzione A: Pubblica come release normale (non pre-release)
- Opzione B: Se vuoi pre-release, usa build beta: `npm run electron:build:beta`

### 3. Verifica i log

Apri la console dell'app (View → Toggle Developer Tools) e cerca:
```
[Auto-updater] Current app version: 0.1.0
[Auto-updater] Is beta: false
[Auto-updater] Channel: default (stable releases)
[Auto-updater] Checking for update...
[Auto-updater] Update not available...
```

Se vedi errori, controlla:
- Errore di autenticazione GitHub?
- Errore di connessione?
- File `latest-mac.yml` mancante nella release?

### 4. Verifica i file nella release

La release GitHub deve contenere:
- File dell'app (`.dmg`, `.zip`, `.exe`, etc.)
- File di update: `latest-mac.yml` (o `latest.yml`, `latest.json`)

Se mancano i file di update, electron-builder non li ha generati durante la pubblicazione.

## Checklist Debug

- [ ] La versione della nuova release è maggiore dell'app installata?
- [ ] La release è pubblicata come normale (non pre-release)?
- [ ] I file `latest-*.yml` sono nella release GitHub?
- [ ] L'app non è in modalità sviluppo?
- [ ] La console mostra errori specifici?

## Test rapido

1. **Incrementa versione**: `package.json` → `"version": "0.1.1"`
2. **Rifai build**: `npm run electron:build:mac`
3. **Pubblica**: `npm run electron:publish`
4. **Verifica**: Apri l'app installata → Menu → Verifica aggiornamenti
5. **Controlla console**: View → Toggle Developer Tools → Console

## Comandi utili

```bash
# Vedere versione corrente
cat package.json | grep '"version"'

# Pubblicare come release normale
npm run electron:publish

# Pubblicare come pre-release (beta)
npm run electron:publish:beta
```

