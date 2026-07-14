# Guida operativa — MVP docente cartaceo

**Stato:** M1 + M2 + M3-lite completati; funzionante sia in locale con emulatori Firebase sia su Firebase DEV (https://schoolforge-dev.web.app). Questa guida descrive il flusso docente in locale; per il portale studente vedi la sezione dedicata più sotto e la checklist manuale in `documentazione/evidenze/`.
**Aggiornato al:** 2026-07-09

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

La pagina di login mostra un solo bottone, **Accedi con Google** (`signInWithPopup` con `GoogleAuthProvider` — non ci sono più campi email/password nella UI). Contro l'Emulator Auth, il popup apre il selettore di account fittizio dell'emulatore invece di un vero login Google: scegli "Aggiungi nuovo account" per crearne uno al volo, oppure riusa un account già creato in una sessione precedente (visibile anche in <http://localhost:4000/auth>).

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
descrizione: Descrizione sintetica del programma annuale
---

# Contenuto libero opzionale
```

Se presente, questi metadati (anno scolastico, docente, materia, classe, descrizione) compaiono nel pannello **Info corso** e sono modificabili dal docente. DUX-07B salva `descrizione` nel front matter senza toccare il corpo Markdown; per compatibilità, nei file legacy privi della chiave `descrizione` continua a valere come fallback la prima riga descrittiva del corpo. Se `programma.md` è assente ma il corso ha un import attivo, il primo salvataggio dei metadati lo crea nella radice dell'import. Un corso senza import deve invece essere prima popolato.

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

Naviga in **Classi** dalla barra laterale.

1. Inserisci il nome della classe nel campo *Nome* (es. *3A Informatica*).
2. Aggiungi opzionalmente una descrizione.
3. Clicca **Crea classe**.

### 5b. Assegnazione del programma a una o più classi

Un programma **senza classi assegnate non è mai visibile a nessuno studente**, anche se le sue lezioni sono importate e il portale studente è attivo — questo è il default sicuro, non un bug da segnalare.

In **Corsi**, sulla riga del programma:
1. Clicca il bottone **Classi**.
2. Seleziona una o più classi dal pannello.
3. Clicca **Salva**.

Solo dopo questo passo gli studenti approvati e assegnati a una di quelle classi vedranno le lezioni del programma nel portale studente (§ "Portale studente" più sotto).

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

### 8b. Pubblicazione / nascondimento della verifica

Una verifica ha uno stato di visibilità indipendente: **pubblica** o **nascosta**. Attivarla non la pubblica automaticamente; una verifica attiva o chiusa e pubblica è visibile nel portale studente.

Nella riga della verifica (o nel pannello di dettaglio):
1. Clicca l'icona 👁️/🙈 per alternare **Pubblica allo studente** / **Nascondi allo studente**.
2. Lo stato compare come badge "pubblica" o "nascosta" nella colonna Stato.

Chiudere la verifica preserva la visibilità scelta. Se resta pubblica è consultabile e scaricabile, ma non può più essere avviata o ripresa online.

### 9. Download PDF docente (anteprima) e PDF studente

Dal pannello di una verifica **attiva**, sono disponibili tre PDF, tutti generati nel browser senza persistenza:

| Bottone | Contenuto | Nome file |
|---|---|---|
| Scarica PDF (⬇️) | Anteprima di ciò che vedrà lo studente: titolo, classe, campi Nome e Cognome/Data **vuoti**, domande numerate `[N pt]`, opzioni ○ per le chiuse, righe vuote per le aperte, punteggio totale in calce. Nessuna soluzione. | `aaaammgg-classe-titoloverifica.pdf` |
| Scarica PDF soluzioni (🔑, anche su verifica chiusa) | Come sopra, più le soluzioni: risposta testuale per le aperte, opzione(i) corretta(e) evidenziate per le chiuse. Solo per il docente. | `<titolo>_soluzioni_docente.pdf` |
| Scarica PDF studente (dal portale studente) | Identico all'anteprima docente, ma con Nome e Cognome/Data **precompilati** dall'identità Google dello studente al momento del download (mai salvati). | `aaaammgg-classe-titoloverifica-NomeStudente-CognomeStudente.pdf` |

`aaaammgg` è la data di generazione del PDF (non una data salvata); `classe` è il nome della classe della verifica o `senza-classe` se assente; titolo e nome studente sono sanitizzati per il filesystem.

---

## Gestione studenti (M3-lite)

In **Impostazioni → Studenti** (o sezione equivalente nella barra laterale) il docente gestisce chi può accedere al portale studente:

1. **Interruttori globali**: `Portale studente attivo` (deve essere acceso perché uno studente legga qualunque contenuto, indipendentemente dall'approvazione) e `Richieste di accesso studente` (se acceso, un utente Google non ancora registrato può auto-registrarsi come `pending` al primo login; se spento, solo il docente crea `students/{uid}`).
2. **Stati studente**: `pending` (in attesa, nessun contenuto visibile), `approved` (contenuto visibile solo se ha anche una classe compatibile), `blocked` (nessun contenuto, reversibile).
3. **Approvazione/blocco**: dalla riga dello studente, il docente clicca **Approva** o **Blocca**. Un `blocked` può essere riportato a `pending` con **Sblocca**.
4. **Assegnazione classe**: dal menu a discesa sulla riga dello studente, il docente seleziona la classe. Uno studente `approved` senza classe non vede alcuna lezione o verifica, anche se il portale è attivo.

## Eliminazione di verifiche e programmi

- Una verifica in stato **bozza** o **chiusa** può essere eliminata definitivamente dal docente (bottone 🗑️, con conferma). Una verifica **attiva** non può essere eliminata direttamente: va prima chiusa.
- Un programma **non può essere eliminato** se esistono verifiche (di qualunque stato) che lo referenziano (`config.programId`): l'app mostra il messaggio "Impossibile eliminare il corso: esistono verifiche associate. Elimina prima le verifiche collegate." Elimina o riassegna prima le verifiche, poi il programma.

---

## Portale studente (M3-lite)

Il portale studente è raggiungibile con lo stesso URL dell'app: il ruolo (docente/studente) è risolto confrontando l'`uid` autenticato con l'`ownerUid` del docente.

1. **Login studente**: lo studente clicca **Accedi con Google** (nessuna email/password, nessuna registrazione con dati autodichiarati). L'identità (nome, email) è quella già verificata da Google.
2. **Richiesta di accesso o creazione manuale**: se `newStudentRequestsEnabled` è attivo, il primo login crea automaticamente un `students/{uid}` in stato `pending`; lo studente vede una schermata di attesa. In alternativa il docente può creare la voce studente manualmente. In entrambi i casi nessun contenuto è visibile finché il docente non approva.
3. **Approvazione e classe**: il docente approva e assegna una classe (vedi "Gestione studenti" sopra). Senza entrambe le condizioni lo studente vede solo un messaggio di attesa/bloccato o "nessuna classe assegnata" — mai un errore tecnico.
4. **Sezione Lezioni**: lo studente vede solo i programmi la cui `classIds` include la propria classe (§5b), e per ciascuno le lezioni pubblicate. Cliccando una lezione ne viene mostrato il contenuto Markdown (titolo, sottotitolo, difficoltà, concetti chiave, obiettivi se presenti nel front matter — mai il pool domande).
5. **Sezione Verifiche**: lo studente vede solo le verifiche **attive e pubblicate** (§8b) della propria classe. Ogni verifica ha un bottone **Scarica PDF** che genera il PDF studente con Nome e Cognome/Data precompilati (§9) — mai soluzioni, mai una consegna online, mai un punteggio.

Verifiche online, consegna digitale, correzione automatica e correzione AI **non sono implementate** in M3-lite: restano specifica di un eventuale M3-full/M4/M5, rinviata.

---

## Limiti noti prima del deploy in produzione

| Limite | Impatto | Fix richiesto |
|---|---|---|
| Dati negli emulatori sono temporanei | Persi al riavvio degli emulatori | Solo per lo sviluppo locale — il deploy DEV su Firebase reale è già attivo |
| Security Rules verificate su emulatore e su DEV reale, non su un progetto PROD dedicato | Possibili differenze residue non ancora osservate | Ripetere la checklist manuale (vedi `documentazione/evidenze/`) al deploy PROD |
| Portale digitale (M3-full), consegna online, correzione (M4), correzione AI (M5) non implementati | Nessun tentativo/punteggio/correzione digitale | Specifica rinviata, fasi successive |
| Bundle size grande (jsPDF ~390 kB gzip 128 kB) | Prima apertura lenta | Lazy import già presente; accettabile per V1 |

---

## Nota operativa: contenuto lezione non caricabile (studente)

Se uno studente vede una lezione nell'elenco ma riceve un errore al click, **non è più (dal deploy DEV) un problema di permessi legati alla classe**: le Storage Rules non verificano più classe/approvazione/metadata per i file lezione (`.md`), solo autenticazione e nome file — vedi `sicurezza.md` §3.2a e `api-contract.md` §6 per il modello attuale. La discovery (quali lezioni compaiono in elenco) resta invece interamente gated da Firestore, quindi una lezione non compare affatto se lo studente non è approvato o non ha la classe compatibile — non genera l'errore di questa nota.

Se l'errore compare comunque dopo che la lezione è visibile in elenco, è quasi sempre un problema transitorio (rete, sessione Google scaduta): far ricaricare la pagina o rifare login allo studente. Se persiste, verificare la console del browser per l'errore esatto prima di ipotizzare un problema di Security Rules.

---

## Comandi di verifica

```bash
pnpm format:check   # Prettier
pnpm lint           # ESLint
pnpm typecheck      # TypeScript
pnpm test           # Vitest (suite unitaria/componenti completa)
pnpm build          # Build produzione
```
