# Firebase — avvio locale

## Prerequisiti

- Node.js 20 LTS
- pnpm 9.x (`corepack enable pnpm`)
- Firebase CLI: `npm install -g firebase-tools`
- Account Google autorizzato sul progetto `schoolforge-dev`

## Prima configurazione

```bash
# 1. Autenticati
firebase login

# 2. Verifica alias (dev → schoolforge-dev)
pnpm firebase:use:dev
```

## Variabili d'ambiente locali

```bash
cp .env.example .env.local
# Apri .env.local e incolla la configurazione client Firebase
# (Firebase console → Project Settings → Your apps → Web app → Config)
# VITE_USE_EMULATORS=true è già impostato nell'esempio
```

`.env.local` è git-ignorato. Non committare mai credenziali o valori privati.

## Avviare gli emulatori

```bash
pnpm emulators
```

Avvia Auth (9099), Firestore (8080), Storage (9199), Functions (5001) e
Hosting (5000) con la Emulator UI su `http://localhost:4000`.

Per persistere i dati tra le sessioni:

```bash
pnpm emulators:export
```

## Cosa NON fare

- Non eseguire `firebase deploy` senza autorizzazione esplicita.
- Non usare `--project production` o l'alias `prod` (non configurato).
- Non committare `.env.local`, chiavi di servizio o token.
- Non abilitare Firestore o Storage dalla console senza aver completato H-01/H-02.
