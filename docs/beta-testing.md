# Guida Beta Testing

Questo documento spiega come distribuire e gestire versioni beta dell'app per i tester.

## Strategia

Strategia ibrida:

1. **Canale Beta Separato**: versioni beta separate dalle stable, con auto-update
2. **Soft Expiration**: warning discreto (non blocca l'app) quando la beta è vicina alla scadenza

Auto-update per i tester tramite `electron-updater`, distribuzione via GitHub Releases, nessun server extra. Note su canali e `latest-*.yml`: [electron.md](electron.md).

## Come creare una build beta

### Build locale (senza pubblicare)

```bash
npm run electron:build:beta        # macOS
npm run electron:build:beta:all    # tutte le piattaforme
```

Le build finiscono in `release/` con `BETA=true`.

### Pubblicare su GitHub (pre-release)

```bash
npm run electron:publish:beta
```

Crea la build e la pubblica come **pre-release**. `electron-updater` cerca aggiornamenti nel canale beta.

Per versioni più esplicite, in `package.json`:

```json
{
  "version": "0.1.9-beta.1"
}
```

## Distribuzione ai tester

Le beta devono essere su GitHub perché l'auto-update funzioni (servono `latest-mac.yml` e equivalenti), anche se i tester scaricano i file a mano.

1. Pubblica: `npm run electron:publish:beta`
2. Verifica su `https://github.com/GiuseppeAceto/Topographic-Granulator/releases` che la release sia **Pre-release**, con artifact e `latest-mac.yml`
3. Condividi i link, ad esempio:
   `https://github.com/GiuseppeAceto/Topographic-Granulator/releases/download/v0.1.9/Undergrain-0.1.9-arm64.dmg`
4. File tipici: `.dmg` / `-mac.zip` (Intel e arm64), `.exe` Windows, AppImage / `.deb` / `.rpm` Linux

Senza GitHub: `npm run electron:build:beta` e condividi `release/`. L'auto-update non funziona; il soft expiration sì.

## Soft expiration

- Banner informativo se restano **≤30 giorni** alla scadenza
- Banner se la beta è scaduta — **non blocca** l'app
- Default: **90 giorni** dalla data di build

In `electron/main.cjs`:

```javascript
const expirationDays = parseInt(process.env.BETA_EXPIRATION_DAYS || '90', 10);
```

O in build:

```bash
BETA_EXPIRATION_DAYS=120 npm run electron:build:beta
```

## Troubleshooting

L'app non trova aggiornamenti beta:

- Build creata con `BETA=true`
- Release pubblicata su GitHub come pre-release
- Versione GitHub più recente di quella installata
- `latest-mac.yml` (o equivalente) presente nella release

Il banner di expiration non appare: serve `BETA=true`; compare solo a ≤30 giorni o dopo la scadenza.
