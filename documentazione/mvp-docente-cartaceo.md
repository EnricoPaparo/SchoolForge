# Guida operativa — MVP docente cartaceo

**Stato:** funzionante in locale con emulatori Firebase (M1 + M2 completati)
**Aggiornato al:** 2026-06-26 (commit `4c1a05c`)

---

## Prerequisiti

| Strumento | Versione | Note |
|---|---|---|
| Node.js | 20 LTS | Runtime |
| pnpm | 9.x | `npm install -g pnpm` |
| Firebase CLI | latest | `npm install -g firebase-tools` |
| Git | qualunque | |

Verifica:

```bash
node --version   # v20.x
pnpm --version   # 9.x
firebase --version
```

---

## Installazione

```bash
git clone <repo>
cd SchoolForge
pnpm install
```

---

## Configurazione variabili d'ambiente

Crea `apps/web/.env.local` con le credenziali degli emulatori locali:

```env
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_AUTH_DOMAIN=demo-schoolforge.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-schoolforge
VITE_FIREBASE_STORAGE_BUCKET=demo-schoolforge.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
VITE_USE_EMULATORS=true
```

> Per un deploy reale su Firebase usa le credenziali del progetto Firebase (senza `VITE_USE_EMULATORS`).

---

## Avvio emulatori Firebase

```bash
npx firebase emulators:start --project demo-schoolforge --only auth,firestore,storage
```

Porte in ascolto:

| Servizio | Porta |
|---|---|
| Auth | 9099 |
| Firestore | 8080 |
| Storage | 9199 |
| Emulator UI | 4000 |

Tieni questa shell aperta per tutta la sessione di lavoro.

---

## Avvio app web

In un secondo terminale:

```bash
cd apps/web
pnpm dev
```

Apri <http://localhost:5173> nel browser.

---

## Flusso operativo MVP

### 1. Login docente

Al primo avvio non esiste un account: creane uno tramite l'Emulator UI Auth (<http://localhost:4000/auth>) oppure lascia che la pagina di login lo crei in automatico se hai un utente già configurato.

Con un utente creato nell'emulatore, inserisci email e password nella schermata di login.

> **Primo avvio:** apparirà la schermata "Inizializza SchoolForge". Clicca **Diventa proprietario** per associare l'account al portale docente. Questa operazione va fatta una sola volta.

### 2. Creazione programma

Naviga in **Programmi / UDA / Lezioni** dalla barra laterale.

Nel modulo in basso a sinistra:
1. Inserisci il titolo del programma (es. *Reti Informatiche*).
2. Clicca **Crea programma**.

Il programma appare nella lista. Cliccaci sopra per selezionarlo.

### 3. Preparazione dello ZIP didattico

Lo ZIP deve rispettare la struttura:

```
programma.md                 ← opzionale: metadati didattici del programma
uda-01-<slug>/                ← ogni UDA è una cartella
  uda-01-<slug>.md          ← obbligatorio: front matter YAML + contenuto (un file per cartella)
  lezione-001-<slug>.md     ← obbligatorio
  lezione-001-<slug>.pool.md  ← opzionale: pool domande della lezione
  lezione-002-<slug>.md
  lezione-002-<slug>.pool.md
uda-02-<slug>/
  ...
```

`programma.md` è **opzionale** e va messo nella radice dello ZIP (non dentro una cartella UDA). Un kit di esempio completo e importabile è scaricabile dalla sezione **Template** dell'app (bottone "Scarica kit completo"): contiene 2 UDA con metadati compilati (competenze, obiettivi), 2 lezioni per UDA, un pool valido per una lezione di ciascuna UDA (l'altra lezione resta senza pool) e tutti e tre i tipi di domanda (aperta, chiusa singola, chiusa multipla) — utile per verificare rapidamente l'intero flusso di import senza preparare contenuti reali.

**Front matter opzionale per `programma.md`** (nella radice dello ZIP):

```yaml
---
titolo: Nome del programma
anno_scolastico: '2025/2026'
classe: 3A
materia: Informatica
docente: Nome Cognome
---

Descrizione sintetica del programma annuale.
```

Se presente, questi metadati (anno scolastico, docente, materia, classe, descrizione) compaiono nel pannello **Info corso**. Se assente, l'import funziona comunque: il pannello info mostra solo UDA/lezioni/domande.

**Front matter obbligatorio per il file UDA** (es. `uda-01-reti/uda-01-reti.md`):

```yaml
---
titolo: Titolo della UDA
competenze:
  - Competenza A
obiettivi:
  - Obiettivo 1
---

# Contenuto Markdown...
```

Il testo dopo il front matter (`# Contenuto Markdown...`) è usato anche come breve descrizione dell'UDA nel pannello **Info UDA**, insieme a competenze e obiettivi. Se un campo manca, il pannello mostra "Non indicato" — non vengono mai mostrati dettagli tecnici (import id, percorsi di storage).

**Front matter opzionale per il file lezione** (es. `lezione-001-http.md`):

```yaml
---
titolo: 'HTTP'
sottotitolo: 'Il protocollo del web'
difficolta: 'base'
concetti_chiave:
  - 'Client/server'
  - 'Richiesta/risposta'
obiettivi:
  - 'Descrivere il ciclo richiesta/risposta'
---

# HTTP

Contenuto della lezione in Markdown.
```

Tutti i campi sono opzionali (`titolo` è raccomandato). Se presenti, `titolo`/`difficolta` compaiono anche nella riga della lezione in **Corsi** (con la numerazione dal filename come prefisso); l'intestazione completa (titolo, sottotitolo, difficoltà, concetti chiave, obiettivi) compare nella sezione **Lezioni** quando la lezione è aperta, sia lato docente che lato studente, e nell'intestazione del PDF lezione. Il filename resta sempre l'ordinamento — il front matter cambia solo cosa viene mostrato. Se il front matter è assente o non è YAML valido, l'import e la visualizzazione funzionano comunque: il titolo mostrato ricade sul filename pulito (es. `lezione-001-http.md` → "Http"), senza numerazione se il filename non segue lo schema `lezione-NNN-...`.

**Formato pool domande** (es. `lezione-001-http.pool.md`):

```yaml
---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: aperta
    difficolta: 1
    peso: 2
    testo: 'Testo della domanda.'
    soluzione: 'Risposta attesa (non inclusa nel PDF studente).'
  - id: q2
    tipo: chiusa_singola
    difficolta: 1
    peso: 3
    testo: 'Domanda a scelta singola?'
    opzioni:
      - id: a
        testo: 'Opzione A'
      - id: b
        testo: 'Opzione B'
    soluzione:
      - a
---
```

I template scaricabili sono disponibili nella sezione **Repository didattico** dell'app.

> **Artefatti OS automaticamente filtrati:** `__MACOSX/`, `.DS_Store`, file nascosti (`.`), file vuoti.
> **Wrapper strippato automaticamente:** se lo ZIP contiene una singola cartella radice (es. `corso-reti/uda-01-reti/...`), il prefisso viene rimosso.

### 4. Import ZIP

Con il programma selezionato, nel pannello di destra:

1. Clicca **Scegli file** nella sezione *Importa ZIP didattico*.
2. Seleziona il file `.zip`.
3. Clicca **Importa ZIP**.

Attendi il messaggio di conferma: *Import completato: N UDA, N lezioni, N domande.*

In caso di errore di validazione, il messaggio indica il file e il campo specifico da correggere.

La **Dashboard prontezza** mostra lo stato del repository:
- ✓ *Generazione verifiche*: ci sono domande eleggibili nel questionIndex.
- ✓ *Lezioni importate*, *UDA*, *Pool validi*.
- ⚠ *Lezioni svolte*: nessuna lezione marcata come svolta (normale all'inizio).

### 5. Creazione classe

Naviga in **Impostazioni** dalla barra laterale (contiene la gestione classi).

1. Inserisci il nome della classe nel campo *Nome* (es. *3A Informatica*).
2. Aggiungi opzionalmente una descrizione.
3. Clicca **Crea classe**.

### 6. Creazione verifica

Naviga in **Verifiche cartacee**.

Nel modulo *Crea nuova verifica*:
1. Inserisci il **Titolo** (es. *Verifica Reti — Modulo 1*).
2. Seleziona il **Programma** dal menu a discesa.
3. Seleziona opzionalmente la **Classe**.
4. Clicca **Crea verifica**.

La verifica appare nella lista laterale con stato **BOZZA**.

### 7. Selezione domande

Clicca sulla verifica nella lista per aprire il pannello di dettaglio.

La sezione *Selezione domande* mostra tutte le domande eleggibili dal questionIndex del programma (tipo, difficoltà, peso, punti massimi).

Seleziona le domande tramite i checkbox. Il contatore mostra quante domande sono state selezionate.

> Sono necessarie almeno **1 domanda** per poter attivare la verifica.

### 8. Attivazione

Con almeno una domanda selezionata:

1. Clicca **Attiva verifica**.
2. Leggi il messaggio di conferma (la configurazione diventa immutabile).
3. Clicca **Conferma attivazione**.

La verifica passa allo stato **ATTIVA**. Appare il pulsante **Scarica PDF**.

### 9. Download PDF studente

Clicca **Scarica PDF**. Il browser scarica il file `<titolo-verifica>_studente.pdf`.

Il PDF contiene:
- Titolo verifica
- Classe (se presente)
- Campi Nome e Cognome, Data
- Domande numerate con punteggio massimo `[N pt]`
- Per domande chiuse: opzioni con ○
- Per domande aperte: righe vuote per la risposta
- Totale punteggio in calce

Il PDF **non contiene** soluzioni, risposte corrette o marcatori di risposta.

---

## Limiti noti prima del deploy in produzione

| Limite | Impatto | Fix richiesto |
|---|---|---|
| Dati negli emulatori sono temporanei | Persi al riavvio degli emulatori | Deploy su Firebase reale (H-01/H-02) |
| Nessun dominio pubblico | Solo `localhost:5173` | Firebase Hosting deploy |
| Security Rules non verificate su progetto reale | Possibili differenze vs emulatori | Test su `dev` Firebase reale |
| Portale studenti (M3) non implementato | Nessun tentativo digitale | Milestone M3 |
| Correzione risultati (M4) non implementata | Nessun punteggio registrato | Milestone M4 |
| La voce "Classi" è sotto "Impostazioni" nella navigazione | UX non intuitiva | UX fix futuro |
| Bundle size grande (jsPDF ~390 kB gzip 128 kB) | Prima apertura lenta | Lazy import già presente; accettabile per V1 |

---

## Nota operativa: lezione visibile in lista ma contenuto non caricabile (studente)

Uno studente approvato con classe compatibile può vedere una lezione nell'elenco ma ricevere "Contenuto non disponibile per la tua classe" (o l'errore generico) al click. **Non è quasi mai un problema di permessi troppo stretti**: dalla milestone M3L-C ogni file lezione su Storage è taggato all'upload con `customMetadata.programId`, necessario alle Security Rules per verificare la classe. Un file caricato **prima** di M3L-C non ha questo metadata ed è negato di default a ogni studente — per design, non per bug (vedi `sicurezza.md` §3.2 e `api-contract.md` §6).

**Fix**: il docente deve reimportare lo ZIP del programma interessato (stesso file, o una versione aggiornata) dalla sezione **Corsi**. L'import rigenera tutti i file Storage con il metadata corretto; non esiste un backfill automatico sui file già esistenti. Questo vale anche per import fatti prima della PR frontmatter lezioni: reimportare aggiorna anche `titolo`/`difficolta` in Firestore se il file `.md` è stato aggiornato con un front matter.

Se il problema persiste **dopo** un reimport, non è più il caso legacy: verificare che lo studente sia `approved`, che `students/{uid}.classId` coincida con una delle `classIds` del programma, e che `settings/studentAccess.studentPortalEnabled` sia `true`.

---

## Comandi di verifica

```bash
pnpm format:check   # Prettier
pnpm lint           # ESLint
pnpm typecheck      # TypeScript
pnpm test           # Vitest (197 test)
pnpm build          # Build produzione
```
