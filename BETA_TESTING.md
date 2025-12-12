# Guida Beta Testing

Questo documento spiega come distribuire e gestire versioni beta dell'app per i tester.

## Strategia Implementata

Abbiamo implementato una strategia **ibrida** che combina:

1. **Canale Beta Separato**: Versioni beta separate dalle stable con auto-update
2. **Soft Expiration**: Warning discreto (non blocca l'app) quando la beta è vicina alla scadenza

### Vantaggi

- ✅ **Auto-update** per i tester tramite electron-updater
- ✅ **Nessuna complessità** di licenze/seriali
- ✅ **Controllo** sulla distribuzione via GitHub releases
- ✅ **Reminder discreto** che è una versione beta (non invasivo)
- ✅ **Facile gestione** - nessun server necessario

## Come Creare una Build Beta

### 1. Build Beta Locale (senza pubblicare)

```bash
# Solo macOS
npm run electron:build:beta

# Tutte le piattaforme
npm run electron:build:beta:all
```

Questo creerà le build nella cartella `release/` con il flag `BETA=true` attivo.

### 2. Pubblicare Beta su GitHub (come Pre-release)

```bash
npm run electron:publish:beta
```

Questo:
- Crea una build beta
- Pubblica su GitHub come **pre-release** (non visibile nella pagina principale)
- Configura electron-updater per cercare aggiornamenti nel canale "beta"

### 3. Configurare Versione Beta (Opzionale)

Per versioni beta più esplicite, modifica `package.json`:

```json
{
  "version": "0.1.0-beta.1"
}
```

O usa una versione normale e electron-updater userà il canale "beta" tramite l'env var.

## Come Distribuire ai Beta Tester

### Workflow Consigliato: Pubblica su GitHub + Download Manuale

**Importante**: Per far funzionare l'auto-update, le beta DEVONO essere pubblicate su GitHub, anche se i tester scaricano i file manualmente.

1. **Pubblica la beta su GitHub**:
   ```bash
   npm run electron:publish:beta
   ```
   Questo crea la build e la pubblica come **pre-release** su GitHub.
   
   ✅ **Verifica**: Dopo il comando, vai su `https://github.com/GiuseppeAceto/Topographic-Granulator/releases` e controlla che:
   - La release sia marcata come **"Pre-release"**
   - Tutti i file siano presenti (`.dmg`, `.zip`, `.exe`, etc.)
   - Il file `latest-mac.yml` (o equivalente) sia presente (necessario per auto-update)

2. **Condividi i link ai file** con i tester:
   
   I tester possono:
   - **Opzione A**: Andare sulla pagina GitHub releases e scaricare il file per la loro piattaforma
   - **Opzione B**: Usare i link diretti (più comodo)
   
   Dopo aver pubblicato, GitHub creerà automaticamente link diretti tipo:
   ```
   https://github.com/GiuseppeAceto/Topographic-Granulator/releases/download/v0.1.0/Undergrain-0.1.0-arm64.dmg
   ```
   
   I file disponibili per ogni piattaforma:
   - **macOS (Intel)**: `Undergrain-0.1.0-mac.zip` o `Undergrain-0.1.0.dmg`
   - **macOS (Apple Silicon/M1/M2)**: `Undergrain-0.1.0-arm64-mac.zip` o `Undergrain-0.1.0-arm64.dmg`
   - **Windows**: `Undergrain-0.1.0-x64.exe` (installer) o `Undergrain-0.1.0-x64-portable.exe`
   - **Linux**: `Undergrain-0.1.0.AppImage`, `Undergrain-0.1.0-amd64.deb`, o `Undergrain-0.1.0.x86_64.rpm`

3. **I tester scaricano e installano** manualmente il file per la loro piattaforma

4. **L'auto-update funzionerà automaticamente** perché:
   - I file sono pubblicati su GitHub
   - electron-updater può leggere i file di update (`latest-mac.yml`, etc.)
   - L'app cercherà aggiornamenti nel canale "beta"

### Alternativa: Solo Download Manuale (Senza Auto-update)

Se per qualche motivo NON vuoi pubblicare su GitHub:

1. Crea build beta: `npm run electron:build:beta`
2. Condividi i file dalla cartella `release/`
3. I tester installano manualmente
4. ⚠️ **L'auto-update NON funzionerà** (manca il file `latest-mac.yml` su GitHub)
5. ✅ **Il soft expiration funzionerà comunque** (non dipende da GitHub)
6. Per aggiornare, i tester dovranno scaricare manualmente la nuova versione

## Soft Expiration

Il sistema include un **soft expiration** che:

- Mostra un **banner informativo** quando restano **≤30 giorni** alla scadenza
- Mostra un **banner informativo** se la beta è scaduta (ma **non blocca** l'app)
- Default: **90 giorni** dalla data di build

### Personalizzare Scadenza

Modifica in `electron/main.cjs`:

```javascript
const expirationDays = parseInt(process.env.BETA_EXPIRATION_DAYS || '90', 10);
```

Oppure imposta la variabile d'ambiente durante la build:

```bash
BETA_EXPIRATION_DAYS=120 npm run electron:build:beta
```

## Workflow Consigliato

1. **Sviluppo normale** → Test locale
2. **Pubblica beta su GitHub** → `npm run electron:publish:beta`
   - Crea la build e la pubblica come pre-release
3. **Condividi link diretti** ai file con i tester:
   - macOS Intel: `Undergrain-0.1.0-mac.zip` o `.dmg`
   - macOS Apple Silicon: `Undergrain-0.1.0-arm64-mac.zip` o `.dmg`
   - Windows: `Undergrain-0.1.0-x64.exe`
   - Linux: `Undergrain-0.1.0.AppImage`
4. **I tester scaricano** il file per la loro piattaforma dalla pagina GitHub
5. **I tester installano** manualmente (drag & drop su macOS, installer su Windows/Linux)
6. **L'auto-update funziona** automaticamente per le versioni successive
7. **Feedback** → Raccogli feedback dai tester
8. **Fix/Update** → Pubblica nuova beta: `npm run electron:publish:beta`
9. **I tester ricevono notifica** di aggiornamento disponibile (se hanno la vecchia versione)
10. **Release stable** → Quando pronta, rimuovi flag beta e pubblica normalmente

## Note Importanti

- ⚠️ **Auto-update richiede GitHub**: L'auto-update funziona SOLO se le beta sono pubblicate su GitHub (per i file `latest-mac.yml`, etc.)
- ⚠️ Le versioni beta cercano aggiornamenti solo da **pre-release** su GitHub
- ⚠️ Le versioni stable cercano aggiornamenti da **release normali**
- ✅ I tester possono **scaricare manualmente** i file dalla pagina GitHub release
- ✅ I tester **installano manualmente** il file per la loro piattaforma
- ✅ Dopo l'installazione manuale, **l'auto-update funziona** per le versioni successive
- ✅ I banner di expiration sono **non invasivi** e possono essere chiusi
- ✅ L'app **non si blocca** mai, anche se la beta è scaduta
- ✅ Puoi sempre pubblicare nuove beta per estendere la scadenza

## Troubleshooting

### L'app non trova aggiornamenti beta

Verifica che:
- La build sia stata creata con `BETA=true`
- La release sia stata **pubblicata su GitHub** (non solo build locale)
- La release su GitHub sia marcata come **pre-release**
- La versione su GitHub sia più recente di quella installata
- Il file `latest-mac.yml` (o equivalente) esista nella release GitHub

### Il banner di expiration non appare

- Verifica che la build sia stata creata con `BETA=true`
- Controlla la console per eventuali errori
- Il banner appare solo se restano ≤30 giorni o se è scaduta

## Best Practices

1. **Versioning chiaro**: Usa versioni come `0.1.0-beta.1`, `0.1.0-beta.2`, etc.
2. **Changelog**: Documenta i cambiamenti in ogni beta
3. **Feedback**: Chiedi feedback specifico ai tester
4. **Stable release**: Pubblica una release stable dopo il periodo di beta testing
5. **Comunicazione**: Comunica chiaramente ai tester che è una versione beta

