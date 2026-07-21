# Gate GVEX — Human Gate post-rollout VEX

**Stato:** `PENDING`  
**Ambiente:** `schoolforge-dev`  
**Data rollout:** 21 luglio 2026  
**SHA distribuito:** `1399faeb1539b1adf1fd9d0ead1bb485ca5d9d53`  
**URL:** <https://schoolforge-dev.web.app>

Il rollout automatico è riuscito, ma **non equivale al superamento del Gate GVEX**. Il Gate
resta `PENDING` finché il docente non completa e conferma la checklist manuale seguente.

## 1. Evidenza automatica e rollout

- Node portabile ufficiale: `v22.23.1`; SHA-256 ZIP verificato:
  `7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29`.
- pnpm: `9.15.9`; anche `pnpm exec node --version` ha restituito `v22.23.1`.
- Format, lint e typecheck monorepo: PASS.
- Functions: **532/532** test PASS.
- Web: **1610/1610** test PASS.
- `RoleGate`: **19/19** PASS.
- `StudentShell`: **21/21** PASS.
- Security Rules Emulator: **493/493** test PASS.
- Build Functions, lesson-contract e web: PASS.
- `git diff --check`: PASS; working tree pulito prima e dopo il preflight.

Ordine di deploy, interrotto automaticamente in caso di errore:

1. Functions: `assignVerificationVariant`, `aiCorrectionPreview`, `aiCorrectionRun` — PASS;
2. Firestore Rules — PASS;
3. Hosting — PASS.

Verifica post-deploy: Hosting HTTP 200 e le tre callable risultano Functions v2, Node.js 22,
regione `us-central1`.

Vincoli rispettati: solo DEV; nessun PROD; nessuna chiamata OpenAI; nessuna migrazione o
cleanup; nessun indice; nessuna Storage Rule.

## 2. Dati di prova consigliati

Preparare una verifica online DEV con:

- almeno due domande comuni;
- almeno due gruppi equivalenti, ciascuno con almeno due alternative;
- una domanda aperta e una chiusa nella variante risultante;
- due studenti approvati appartenenti alla classe assegnata.

Le ripetizioni casuali tra studenti sono ammesse: il contratto non garantisce varianti diverse.

## 3. Checklist manuale docente e studenti

### Builder e attivazione

- [ ] Il docente crea/modifica i gruppi dal builder senza drag-and-drop e vede riepilogo,
      warning e blocchi coerenti.
- [ ] Una domanda non può appartenere a più gruppi e un gruppo invalido impedisce
      l'attivazione con un messaggio leggibile.
- [ ] La verifica `same_questions` continua ad attivarsi e funzionare come prima.
- [ ] La verifica `equivalent_variants` si attiva senza mostrare al docente errori inattesi.

### Prima apertura, ripresa e idempotenza

- [ ] Lo studente A apre la verifica e vede tutte le comuni più una sola alternativa per gruppo.
- [ ] Refresh, logout/login e riapertura mostrano allo studente A la stessa assegnazione.
- [ ] Un doppio click su «Apri» non crea una seconda consegna né cambia variante.
- [ ] Lo studente B vede una variante valida; è accettabile che coincida con quella di A.
- [ ] Navigatore, ordine casuale visivo e limite caratteri lavorano solo sulle domande assegnate.

### Isolamento e sicurezza osservabile

- [ ] Nel DOM, nello stato visibile e nelle risposte Network della sessione studente non compaiono
      testi, opzioni o soluzioni delle alternative non assegnate.
- [ ] Non compaiono `teacherSnapshot`, gruppi equivalenti completi o soluzioni corrette.
- [ ] Tentativi di salvare risposte per order non assegnati sono rifiutati senza corrompere la
      consegna valida.
- [ ] Il PDF studente è nascosto/disabilitato per `equivalent_variants`.

### Consegna e monitor docente

- [ ] Entrambi gli studenti salvano e consegnano; risposte e flag riguardano solo la variante.
- [ ] Il monitor docente mostra una sola consegna per studente e dati coerenti.
- [ ] Eliminando una consegna ammessa e riaprendo la verifica si ottiene un nuovo svolgimento
      valido; nessun dato della vecchia assegnazione resta esposto.

### Correzione, IA e restituzione

- [ ] Il workspace manuale mostra soltanto le domande assegnate e calcola massimo, totale e
      percentuale sulla variante.
- [ ] Salva, completa, azzera e riapri mantengono la stessa variante e non introducono
      evaluation estranee.
- [ ] La preview IA considera soltanto le domande assegnate e non espone alternative. Una
      chiamata OpenAI reale **non è richiesta** da questo smoke e necessita di autorizzazione
      separata se si decide di eseguirla.
- [ ] La restituzione studente contiene solo domande, risposte, punteggi, feedback e — se
      abilitate — soluzioni della variante assegnata.

### Export e regressione

- [ ] Registro PDF/CSV usa punteggio massimo e percentuale della variante per ogni consegna.
- [ ] Il PDF docente della verifica resta completo; il PDF studente VEX resta disabilitato.
- [ ] Una verifica `same_questions` completa il flusso apertura → consegna → correzione →
      restituzione senza regressioni né callable VEX lato client.
- [ ] Desktop e mobile non presentano overflow o controlli irraggiungibili nei flussi verificati.

## 4. Chiusura del Gate

Compilare soltanto dopo lo smoke:

- Data verifica: `PENDING`
- Docente verificatore: `PENDING`
- Esito: `PENDING`
- Anomalie o limiti accettati: `PENDING`

Il Gate GVEX potrà essere dichiarato `PASS` solo con tutte le voci essenziali confermate e senza
fughe di alternative o soluzioni. Fino ad allora lo stato ufficiale resta **PENDING**.
