# SchoolForge — Edge case di dominio

**Versione:** 2.0
**Data:** 24 giugno 2026
**Stato:** baseline
**Input vincolante:** [Analisi dei requisiti v2.0](analisi-requisiti.md), [Architettura v2.0](architettura.md)
**Destinatari:** team di implementazione, QA

Questo documento raccoglie i casi di confine che emergono in implementazione e che, se non decisi a priori, diventano ambiguità o bug. Ogni caso ha un comportamento atteso vincolante. I casi qui descritti devono avere un test corrispondente (cfr. [test-strategy.md](test-strategy.md), §9).

---

## 1. Verifiche e snapshot

| Caso | Comportamento atteso |
|---|---|
| La Lezione fonte viene **modificata** dopo l'attivazione | Lo snapshot `exams/{id}/items` resta invariato; la verifica non rilegge il Markdown (BR-DOM-02). |
| La Lezione fonte viene **eliminata** dopo l'attivazione | Idem: snapshot invariato; le consegne restano consultabili (AC-REP-03). |
| Il **pool** di una lezione viene svuotato dopo l'attivazione | Nessun effetto sulle verifiche già attive; la lezione resta valida ma non genera nuove domande. |
| Tentativo di **modificare** una verifica `attiva` | Rifiutato (`PRECONDITION_FAILED`/`CONFLICT`); l'unica via è creare una nuova verifica. |
| Verifica `chiusa` o `annullata` riceve un accesso dal Portale | Rifiutato: `acceptsAccess: false`; nessun PDF generato, nessuna email bruciata. |
| Configurazione con somma dei minimi di difficoltà **> totale** domande | Bloccata prima dell'attivazione con messaggio esplicito (BR-VER-02). |
| Corpus insufficiente a coprire la configurazione e **AI non attiva** | Attivazione bloccata indicando il fabbisogno non coperto (BR-VER-04). |
| Variante `tutte_uguali`: ordine/selezione domande | Seed fisso alla prima generazione, riusato per tutti gli studenti (BR-VER-03). |
| Variante `tutte_diverse`: due studenti, stessa email impossibile | Seed per email; ogni email riceve un set conforme ai minimi. |

## 2. Email bruciata

| Caso | Comportamento atteso |
|---|---|
| Due richieste **simultanee** con la stessa email | Esattamente una riesce; l'altra riceve `EMAIL_BURNED` (409). La transazione è atomica (BR-VER-12). |
| Stessa email con **maiuscole/spazi** diversi | Normalizzazione (lowercase/trim) prima del confronto: trattata come la stessa email. |
| Email già bruciata sul canale **cartaceo**, poi tenta il **digitale** | Rifiutata: l'email bruciata vale per la verifica, indipendentemente dal canale. |
| Il **docente** scarica più volte il PDF | Sempre consentito; nessun record `burned` creato (FR-VER-05). |
| Record `burned` creato per errore (es. studente sbagliato) | Invalidabile solo da una funzione amministrativa auditata (piano §10.2); non è auto-servizio. |
| Studente con **due account** Google scolastici | Può accedere una volta per ciascuna email; atteso e non bloccato (la chiave è l'email). |

## 3. Studenti e identità

| Caso | Comportamento atteso |
|---|---|
| Primo accesso di uno studente mai visto | Record creato **lazy** con la sola email come chiave; nome/cognome/classe facoltativi. |
| Studente cambia **classe** durante l'anno | Le consegne storiche conservano `classNameAtSubmission`; l'aggiornamento del registro non le altera (BR-STO-01). |
| Studente cambia **email** scolastica | È una nuova identità: le consegne con la vecchia email restano associate alla vecchia email. Nessun merge automatico nella V1. |
| Studente inserisce una **classe** diversa al secondo accesso | Irrilevante: l'email è già bruciata; non c'è secondo accesso. |
| Email **fuori dominio** Education | Accesso al Portale rifiutato (`UNAUTHORIZED`). |

## 4. Import e contratto Markdown

| Caso | Comportamento atteso |
|---|---|
| Cartella con alcuni file **invalidi** | Import atomico: il docente importa solo le unità valide selezionate; nessuno stato parziale visibile (BR-REP-02). |
| Lezione **senza** file `.pool.md` | Valida e consultabile, ma non contribuisce alla generazione di verifiche. |
| `id` duplicato tra file in import | Segnalato come **conflitto** (non errore di parsing); il docente decide create/replace. |
| Asset referenziato **mancante** | Segnalato in preflight; non blocca le altre lezioni valide. |
| Front matter con `schoolforge: 2` | Errore esplicito (versione non supportata) con istruzione di migrazione (BR-MD-VER-01). |
| Campi **extra** non dichiarati nel front matter/pool | Warning permissivo: il parser v1 ignora i campi sconosciuti (BR-MD-VER-03). |
| `uda_id` che non appartiene al `program_id` | Errore in fase di import. |
| Import che va in **timeout** a metà | Nessuna promozione visibile; lo staging scade dopo 24h; il docente ripete. |

## 5. Correzione e percentuali

| Caso | Comportamento atteso |
|---|---|
| Consegna con **alcuni** item senza punteggio | Percentuale `non_definitiva` finché mancano punteggi (BR-COR-03). |
| **Rettifica** di un punteggio già assegnato | Conserva valore precedente, autore, data e motivazione (append-only); ricalcola la percentuale (FR-COR-05). |
| Punteggio assegnato **> punteggio massimo** dell'item | Rifiutato (`VALIDATION_ERROR`). |
| Conversione percentuale → **voto** | Non gestita dal sistema: è una decisione pedagogica del docente (BR-COR-04). |
| Consegna **cartacea** | Corretta fuori dal sistema; SchoolForge può registrare il contenitore ma non gestisce la correzione cartacea. |

## 6. AI (Modulo 5)

| Caso | Comportamento atteso |
|---|---|
| Item senza domanda/soluzione/risposta/lezione | Proposta `blocked`; richiede correzione manuale (BR-AI-COR-02). |
| Proposta AI con punteggio **> massimo** | Rifiutata dal gateway, non solo dalla UI (BR-AI-COR-03). |
| **Approvazione massiva** con proposte miste | Approva solo le idonee; esclude bloccate/già modificate; un audit per consegna (BR-AI-COR-04). |
| Chiamata AI **senza consenso** del docente | Rifiutata (NFR-AI-02). |
| AI non configurata (C-02 non risolta) | Endpoint AI rispondono `PRECONDITION_FAILED`; i flussi manuali restano intatti. |

## 7. Operativi

| Caso | Comportamento atteso |
|---|---|
| **Rollback** del codice applicativo | Snapshot, consegne e audit restano in Firestore; nessun re-processing. |
| Tentativo di un **token studente** su endpoint docente | `FORBIDDEN`. |
| Account docente **non autorizzato** | `UNAUTHORIZED` (403) su ogni endpoint e su Firestore diretto (Security Rules). |
| Perdita del progetto Firebase | Il docente recupera Markdown e asset dall'export ZIP e i dati operativi dall'export Firestore (contratto di uscita, brief). |
