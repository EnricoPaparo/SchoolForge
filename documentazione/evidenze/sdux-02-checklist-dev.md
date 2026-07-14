# SDUX-02 — Checklist manuale DEV (Didattica studente)

Smoke test operativo della nuova **Didattica studente** (`StudentDidatticaView`)
su DEV (`https://schoolforge-dev.web.app`). Verifica parità grafica con la
Didattica docente **rigorosamente read-only**, e che la Modalità verifica
blocchi realmente l'accesso.

> **Stato:** hardening automatico SDUX-02 **completato** (test JS + copertura
> Rules verificati, vedi PR). I passaggi manuali qui sotto sono **da eseguire
> dal docente su DEV** — non ancora eseguiti in questa sessione (nessun accesso
> interattivo a DEV).

Per ogni riga: annotare **PASS/FAIL** e note.

## 0. Prerequisiti

| # | Prerequisito | Esito (PASS/FAIL) | Note |
|---|---|---|---|
| 0.1 | Account **docente** (owner) attivo su DEV | | |
| 0.2 | Account **studente** Google separato, **approvato** (`students/{uid}.status = approved`) | | |
| 0.3 | Portale studente attivo (`settings/studentAccess.studentPortalEnabled = true`) | | |
| 0.4 | Lo studente ha una **classe** assegnata (`students/{uid}.classId`) | | |
| 0.5 | Esiste **almeno un corso** con quella `classId` in `programs.classIds`, con almeno una UDA e una lezione con contenuto | | |
| 0.6 | Modalità verifica **disattivata** all'inizio (`settings/studentAccess.examMode.enabled = false`) | | |

## 1. Desktop (larghezza ≥ 1024px)

| # | Passo | Risultato atteso | Esito | Note |
|---|---|---|---|---|
| 1.1 | Login studente → sezione **Didattica** | Libreria corsi a card, leggibile; nessuna azione docente | | |
| 1.2 | Digitare nel campo **Cerca** parte del titolo | La libreria si filtra per titolo corso | | |
| 1.3 | Aprire un corso | Workspace con sidebar struttura (UDA/lezioni) + contenuto | | |
| 1.4 | Panoramica corso | Elenco UDA leggibile; nessun pulsante Modifica/Elimina/Organizza/Importa | | |
| 1.5 | Aprire una UDA | Elenco lezioni della UDA | | |
| 1.6 | Aprire una lezione | Contenuto Markdown renderizzato correttamente | | |
| 1.7 | Ispezione visiva | Nessuna azione docente visibile; nessun overflow orizzontale della pagina | | |

## 2. Mobile (viewport stretto, es. 390px; DevTools device toolbar)

| # | Passo | Risultato atteso | Esito | Note |
|---|---|---|---|---|
| 2.1 | Libreria corsi | A piena larghezza, nessuno scroll orizzontale di pagina | | |
| 2.2 | Aprire un corso | Nessuna sidebar desktop; compare navigazione progressiva | | |
| 2.3 | Corso → UDA → lezione | Drill-down un livello per volta; back **← Corso / ← UDA / ← Libreria** coerenti | | |
| 2.4 | Titolo UDA/lezione lungo | Va a capo, non esce dal viewport | | |
| 2.5 | Contenuto lezione | Markdown adattato allo schermo, nessuno scroll orizzontale di pagina | | |
| 2.6 | Ruotare verticale ↔ orizzontale | Font e spaziature stabili, nessun layout rotto | | |

## 3. Modalità verifica

> **Conferma DEV:** il docente ha confermato manualmente su DEV che la
> Modalità verifica si comporta correttamente (attivazione blocca la Didattica
> studente, disattivazione la ripristina). Gli altri punti della checklist
> restano da confermare separatamente.

| # | Passo | Risultato atteso | Esito | Note |
|---|---|---|---|---|
| 3.1 | Con Didattica visibile, il docente **attiva** Modalità verifica per la classe dello studente (scope=classes o all) | Sullo schermo studente: la sezione passa subito a **Verifiche**; `StudentDidatticaView` smontata; contenuto lezione **sparito dal DOM**; voce **Didattica** non presente/non utilizzabile | | |
| 3.2 | (DevTools → Network/Console) tentare/osservare query dirette a `programs` e `publicLessons` | Negate dalle Rules (`permission-denied`); nessun dato corso/lezione recuperato | | |
| 3.3 | Il docente **disattiva** Modalità verifica | La Didattica torna disponibile **senza nuovo login** | | |
| 3.4 | Con un secondo studente di **classe non coinvolta** dalla Modalità verifica (scope=classes) | Continua a vedere e leggere la propria Didattica | | |
| 3.5 | Durante Modalità verifica attiva: **refresh** pagina e **nuovo login** studente | La Didattica resta bloccata (protezione valida dopo refresh/login) | | |

## 4. Controllo DevTools — assenza accessi tecnici

| # | Passo | Risultato atteso | Esito | Note |
|---|---|---|---|---|
| 4.1 | DevTools → Network, filtrare per `firebasestorage` durante navigazione Didattica | **Nessuna** richiesta a Firebase Storage (contenuto letto solo da `publicLessons.content`) | | |
| 4.2 | Network/Firestore: osservare le collezioni interrogate | Solo `students/{uid}`, `programs` (filtrati per classe), `publicLessons` | | |
| 4.3 | Cercare richieste verso `.pool.md`, `questionIndex`, `imports/**`, soluzioni | **Nessuna** — nessun pool, domanda, soluzione o documento tecnico raggiunto | | |
| 4.4 | Tentare a mano una lettura di un file `repository/{ownerUid}/…` da console | Negata dalle Storage Rules | | |

## Esito complessivo

- **Verdetto DEV:** ☐ PASS ☐ FAIL
- **Data / operatore:**
- **Note finali:**
