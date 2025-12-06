# Electron Troubleshooting Guide

## Warning di Sicurezza in Dev Mode

I warning di sicurezza che vedi in modalità sviluppo sono **normali e attesi**. Electron li mostra per avvisarti che alcune impostazioni di sicurezza sono rilassate per facilitare lo sviluppo. Questi warning **NON appariranno** quando l'app è compilata per la produzione.

### Warning che vedi:

1. **"webSecurity disabled"** - In dev mode, webSecurity è disabilitato per permettere il caricamento di risorse locali
2. **"allowRunningInsecureContent"** - Permette contenuti misti per sviluppo
3. **"Insecure Content-Security-Policy"** - La CSP è più permissiva in dev per Vite HMR

**Tutti questi warning scompariranno nella build di produzione.**

## Path degli Asset

Ho configurato l'app per usare path relativi (`./`) che funzionano sia in dev che in production:

- Immagini: `./images/logo.png`
- CSS: `./src/styles.css`
- Script: `./src/main.ts`
- Worklets: Gestiti dinamicamente in base all'ambiente

## Se le Immagini Non Caricano

1. **Verifica che Vite serva la cartella public:**
   - I file in `public/` dovrebbero essere accessibili alla root
   - Controlla che `public/images/logo.png` esista

2. **In Dev Mode:**
   - Vite serve i file da `public/` alla root del server
   - I path relativi `./images/logo.png` dovrebbero funzionare

3. **In Production:**
   - I file vengono copiati in `dist/` durante il build
   - I path relativi funzionano correttamente

## Test

Per testare se tutto funziona:

1. **Dev Mode:**
   ```bash
   npm run dev  # Terminal 1
   npm run electron:dev  # Terminal 2
   ```

2. **Production Build:**
   ```bash
   npm run build
   npm run electron:build
   ```

## Note Importanti

- I warning di sicurezza in dev sono **intenzionali** e **non sono un problema**
- L'app è sicura in production (webSecurity abilitato)
- I path relativi funzionano sia in dev che in production
- Se qualcosa non funziona, controlla la console di Electron (DevTools)

