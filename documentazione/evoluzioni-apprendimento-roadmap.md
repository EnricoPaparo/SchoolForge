# SchoolForge — Roadmap evoluzioni apprendimento e varianti

**Stato:** decisioni UX/prodotto approvate; implementazione non avviata.  
**Data baseline:** 18 luglio 2026.  
**Dipendenze:** UI-POLISH-01 completato; M5 operativo su DEV; Gate G7 ancora aperto.

Questa roadmap fissa senza ambiguità le evoluzioni successive al polish V1:

1. robustezza dello spinner IA su mobile;
2. calibrazione strutturata della correzione IA;
3. semplificazione definitiva del contratto delle domande;
4. appunti personali dello studente;
5. varianti equivalenti per le verifiche online;
6. boost grafico conservativo, preceduto da prototipo.

Le evidenziazioni persistenti e il flusso «seleziona testo → appunti» sono stati valutati e **rimossi dalla roadmap**.

## 1. Principi invarianti

- Markdown resta la fonte canonica dei pool.
- Nessun nuovo listener, polling o autosalvataggio aggressivo.
- Pool, soluzioni e strumenti docente non diventano mai leggibili dallo studente.
- La modalità verifica blocca anche gli appunti, non soltanto la Didattica.
- Le varianti non espongono al client domande alternative non assegnate.
- Ogni nuova scrittura è motivata, limitata e misurabile.
- Nessun redesign globale viene applicato senza un prototipo approvato.
- Accessibilità, mobile e `prefers-reduced-motion` sono criteri di accettazione, non rifiniture successive.

## 2. SPINNER-FIX-01 — indicatore IA mobile

### Obiettivo

Lo spinner di anteprima/esecuzione IA deve ruotare su Safari e Brave mobile quando il movimento è consentito e non deve sembrare rotto quando il dispositivo richiede movimento ridotto.

### Contratto UI

- movimento consentito: anello circolare rotante;
- `prefers-reduced-motion: reduce`: indicatore statico distinto, accompagnato dal testo di stato;
- `display: inline-block` e `will-change: transform` per rendere robusta l'animazione mobile;
- nessuna percentuale o progress bar artificiale;
- `role="status"`, `aria-live="polite"` e testo «Calcolo della stima…» / «Correzione in corso…» invariati.

### DoD

- test markup/accessibilità mirato;
- smoke Safari e Brave mobile, con movimento normale e ridotto;
- nessuna modifica a IA, payload, costi o Functions.

### Stato — ✅ Implementato

**Diagnosi confermata.** Negli usi attuali `.spinner` è un flex item dentro `.loading-row` ed è quindi già blockificato: non è dimostrato che il suo `display` originario causasse il problema su Safari o Brave. Il comportamento statico confermato derivava invece dal fallback `prefers-reduced-motion`, che disattivava l'animazione lasciando un **anello statico colorato** simile a uno spinner rotto. `display: inline-block` e `will-change: transform` restano difese di robustezza e compositing, non la correzione di una causa browser dimostrata.

**Fix (solo CSS in `index.css`, nessuna modifica al markup/JS).**

- Movimento normale: `.spinner` ora ha `display: inline-block` (elemento trasformabile → la rotazione si applica su desktop e mobile) e `will-change: transform` (layer composito, animazione fluida su mobile); design circolare e ingombro (1,15rem) invariati.
- `prefers-reduced-motion: reduce`: nessuna rotazione forzata; l'anello è sostituito da **tre puntini statici** sobri (pseudo-elemento `::before` + `box-shadow`, colore `--color-text-muted`), stesso ingombro 1,15rem → nessun salto di layout. L'indicatore resta puramente decorativo (lo `<span>` è già `aria-hidden`); la fonte informativa resta il testo in `role="status"` / `aria-live="polite"` / `aria-busy="true"`, invariati.

Vale per entrambe le fasi (`previewing` «Calcolo della stima…» e `running` «Correzione in corso…»), gli unici usi reali della utility. Nessuna modifica a IA, payload, `teacherGuidance`, `requestId`, idempotenza, costi/budget/ledger, Functions, Rules, schema, indici o dipendenze.

## 3. M5-QUALITY-01 — calibrazione strutturata della correzione IA

### Finestra iniziale

Dialog desktop di circa `640px`, larghezza disponibile completa su mobile. Ordine obbligatorio:

1. titolo e spiegazione breve;
2. numero di consegne selezionate;
3. combobox «Stile di valutazione»;
4. descrizione dinamica dello stile;
5. textarea «Indicazioni aggiuntive per la correzione»;
6. contatore `0/500`;
7. footer con «Annulla» e «Calcola stima», stessa altezza e spaziatura coerente.

### Modalità

| Valore tecnico | Etichetta | Semantica |
|---|---|---|
| `compassionate` | Comprensivo | Premia la comprensione sostanziale, tollera imprecisioni non determinanti e usa la parte alta della fascia di punteggio comunque giustificabile. |
| `balanced` | Equilibrato | Bilancia correttezza, pertinenza, completezza e comprensione. È il default a ogni nuova operazione. |
| `rigorous` | Rigoroso | Richiede gli elementi esplicitamente domandati, penalizza maggiormente omissioni e imprecisioni e usa la parte bassa della fascia giustificabile. |

### Anteprima e sicurezza

- `gradingMode` e `teacherGuidance` sono identici tra preview e run;
- nella schermata di stima sono visibili ma non modificabili;
- modificarli richiede ritorno alla schermata precedente, nuova preview e nuovo `requestId`;
- entrano in identità/hash, stima e prenotazione del run;
- non vengono persistiti in `aiCorrectionRuns`, ledger o log;
- domanda, soluzione e risposta studente restano dati non attendibili;
- le indicazioni docente hanno autorità pedagogica, ma non possono cambiare schema, sicurezza, limiti, `maxPoints` o imporre punteggi non sostenuti dalle evidenze.

### Stato — ✅ Implementato (M5-QUALITY-01)

Calibrazione strutturata implementata. `gradingMode` (`compassionate` | `balanced` | `rigorous`, default `balanced`) attraversa in modo tipizzato UI → client → preview → run → engine → `AiGraderInput` → prompt OpenAI, ed entra nell'hash di selezione (idempotenza): stesso `requestId` con stile o indicazioni diversi ⇒ `invalid_input`, e la UI genera una nuova `requestId` a ogni modifica. `gradingMode` assente — cioè **proprietà omessa** (`undefined`) — ⇒ normalizzato a `balanced` (compatibilità client in cache); valore presente ma non valido, **incluso `null`**, ⇒ `invalid_input` (fail-closed: `null` non è assenza). Il limite delle indicazioni docente è ora **500** caratteri (validazione client + server, trim, vuoto = assente, contatore `0/500`). Il prompt stabilisce che `gradingMode` sposta il punteggio **solo entro la fascia giustificata dalle evidenze** e che `teacherGuidance` ha effetto concreto ma resta subordinata a evidenze e contratto; domanda/soluzione/risposta restano dati non attendibili (anti prompt-injection invariato). Popup con ordine verticale fisso, stile read-only in stima + «Modifica impostazioni». Costi invariati: una sola chiamata provider per consegna con aperte, zero per sole chiuse; stima e prenotazione includono il piccolo testo aggiuntivo, preview e run restano coerenti; nessuna nuova lettura/scrittura Firestore, nessun listener. `gradingMode`/`teacherGuidance` non persistiti in `aiCorrectionRuns`/ledger/log (solo il digest). **M5-QUALITY-02 (benchmark) resta da fare; Gate G7/M5 restano aperti.**

### M5-QUALITY-02 — benchmark

Le stesse risposte sintetiche vengono corrette nelle tre modalità. Il gate richiede differenze osservabili e coerenti nella fascia giustificabile, senza trasformare risposte errate in corrette. Il modello non cambia prima di questa evidenza.

### Stato — READY FOR MANUAL BENCHMARK

Harness e report comparativo sono predisposti sul dataset sintetico unico: stessi raggruppamenti nelle tre modalità, ripetizioni configurabili, differenze di punteggio, controlli tecnici e criteri aggregati di severità. I controlli pedagogici non riducibili a euristiche restano esplicitamente soggetti a revisione docente. Il runner locale è dry-run per default e richiede due flag più conferma interattiva prima di poter costruire il provider. In questa fase non sono state eseguite chiamate reali, non sono stati prodotti risultati o costi e Gate G7 resta aperto. Evidenza: [`evidenze/m5-quality-02-benchmark.md`](evidenze/m5-quality-02-benchmark.md).

### M5-QUALITY-03 — indicazioni docente predefinite (idea futura, non bloccante)

Un docente può voler riutilizzare stabilmente le stesse indicazioni pedagogiche senza
riscriverle a ogni correzione. Prevedere una preferenza personale salvabile che
precompili il campo `teacherGuidance` nella finestra «Correggi con IA».

Decisioni da conservare quando verrà progettata:

- nella prima versione basta **un solo testo predefinito**, non una libreria complessa
  di prompt;
- il testo precompilato resta sempre visibile e modificabile prima della stima;
- una modifica usata per il singolo batch non sovrascrive il predefinito: il salvataggio
  richiede un'azione esplicita, per esempio «Salva come indicazioni predefinite»;
- limite, trim e validazione restano identici a `teacherGuidance` (`500` caratteri);
- la preferenza è owner-only e non è leggibile da studenti;
- il testo non viene copiato in `aiCorrectionRuns`, ledger, audit o log: al provider
  arriva soltanto la copia confermata per l'operazione corrente;
- lettura al massimo una volta per sessione docente, mantenuta in cache; scritture solo
  su salvataggio o cancellazione espliciti;
- nessun listener, polling o effetto sul Gate G7: è una comodità UX successiva e non
  modifica scoring, idempotenza o sicurezza della correzione.

## 4. POOL-SIMPLE — contratto domande definitivo

### Decisione di prodotto

`peso` viene eliminato completamente dal nuovo contratto, dall'interfaccia e dai template. Rimane un solo indicatore quantitativo: `difficolta`.

```text
difficolta = intero 1..5
maxPoints = difficolta
```

Valori decimali e valori fuori intervallo sono invalidi. `maxPoints` resta derivato e non viene scritto nel Markdown.

### Nessun legacy

- nessun parser duale V1/V2;
- nessuna conversione automatica o manuale nell'app;
- nessun banner legacy;
- nessun backfill;
- nessun mantenimento del vecchio `peso` per nuovi flussi;
- prima del rollout il docente elimina autonomamente da DEV programmi, verifiche e dati dipendenti che usano il vecchio contratto;
- PROD non contiene dati da migrare.

Il rollout deve fallire in modo leggibile su un pool vecchio invece di interpretarlo silenziosamente.

### Contratto Markdown target

```yaml
schema: schoolforge-pool/v2
questions:
  - id: q-001
    tipo: aperta
    difficolta: 4
    maxCharacters: 2000
    testo: Spiega il modello client-server.
    soluzione: Il client invia una richiesta e il server elabora una risposta.
```

`maxCharacters` resta opzionale per le sole domande aperte; assente significa limite effettivo `2000`.

### Superfici da aggiornare obbligatoriamente

- package `lesson-contract`: schema, tipi, parser, serializer e fixture;
- Question Pool Editor;
- question index e picker;
- import/export ZIP;
- teacher snapshot e proiezione studente per le nuove verifiche;
- svolgimento, correzione, restituzione, PDF e CSV;
- payload IA: invia difficoltà e `maxPoints`, mai `peso`;
- documentazione canonica e test strategy;
- **Template singoli**;
- **kit completo ZIP generato**;
- esempi e fixture documentali.

### Presentazione UI

```text
Aperta · Difficoltà 4 · 4 punti
```

Nel workspace di correzione:

```text
Difficoltà 4 · Max 4 punti
```

### Pacchetti

| ID | Scope | DoD |
|---|---|---|
| POOL-SIMPLE-00 | Contratto tecnico e inventario completo della rimozione di `peso`; nessun codice UI. | Matrice file/flussi, schema V2, strategia rollout senza legacy. |
| POOL-SIMPLE-01 | Parser/serializer/tipi/fixture e template/kit. | Pool V2 validi 1–5; `peso` rifiutato; tutti i template importabili. |
| POOL-SIMPLE-02 | Editor, index, picker, snapshot, PDF/restituzione/IA. | Nessuna UI o payload nuovo espone `peso`; maxPoints sempre uguale a difficoltà. |
| Gate GPOOL | Smoke import→verifica→svolgimento→correzione→restituzione. | DEV pulito; test automatici e smoke docente/studente verdi. |

## 5. ANNOT — appunti personali dello studente

### UX desktop

Il pulsante «Appunti» nella barra della lezione apre un pannello flottante non modale:

- non ridimensiona la lezione;
- posizione fissa a destra, margine 20–24px;
- larghezza `380px`;
- altezza massima `min(560px, calc(100dvh - 160px))`;
- non trascinabile e non ridimensionabile;
- lezione sottostante ancora leggibile e interattiva;
- superficie giallo caldo poco saturo, testo scuro, bordo ocra e ombra morbida;
- nessuna frase «Privati, visibili solamente a te»;
- eventuale lucchetto solo iconico con etichetta accessibile.

Header:

```text
📝 Appunti                         Salvato ✓   ×
```

Il corpo contiene una sola textarea che usa tutto lo spazio; nessun pannello annidato. La scrollbar interna appare solo oltre l'altezza disponibile.

### UX mobile

Vista dedicata a tutta larghezza con «← Lezione», titolo «Appunti», superficie gialla e pulsante Salva. Tornando indietro si recuperano lezione e posizione precedenti.

### Dati e costo

Path target:

```text
students/{studentUid}/lessonNotes/{publicLessonId}
```

Campi minimi: `programId`, `importId`, `lessonId`, `content`, `createdAt`, `updatedAt`.

- limite 20.000 caratteri;
- lettura solo alla prima apertura;
- nessun listener/polling;
- salvataggio manuale, su blur e dopo 15 secondi di inattività;
- nessuna scrittura se il contenuto non è cambiato;
- guardia dirty in chiusura;
- solo lo studente proprietario legge/scrive;
- il docente non legge;
- accesso negato durante modalità verifica e fuori dalla classe autorizzata.

### Pacchetti

| ID | Scope | DoD |
|---|---|---|
| ANNOT-00 | Contratto, Rules e prototipo statico desktop/mobile. | Prototipo approvato; budget letture/scritture esplicito. |
| ANNOT-01 | Service e Rules. | Test Emulator su ownership, classe e modalità verifica. |
| ANNOT-02 | Pannello desktop, vista mobile e stati di salvataggio. | Smoke desktop/mobile; nessun accesso docente o durante verifica. |
| Gate GANNOT | Evidenze funzionali, sicurezza e costo. | Checklist docente/studente completa. |

## 6. VEX — varianti equivalenti nelle verifiche online

### Scelta modalità

Nel draft, dopo il picker:

```text
Distribuzione online

○ Stesse domande, ordine casuale
○ Varianti equivalenti
```

Le varianti riguardano solo lo svolgimento online. Il PDF docente continua a usare l'insieme completo configurato.

### Modello pedagogico

Le alternative sono definite esplicitamente dal docente in gruppi. Le domande non raggruppate sono comuni. Ogni studente riceve tutte le comuni e una domanda per gruppo.

Alternative nello stesso gruppo:

- stessa UDA;
- stesso tipo;
- stessa difficoltà intera 1–5;
- stesso `maxCharacters` effettivo per le aperte.

Poiché `maxPoints = difficolta`, non serve un ulteriore confronto di peso/punteggio.

### Builder desktop

Riepilogo sempre visibile:

```text
Domande comuni: 2
Gruppi equivalenti: 4
Domande per studente: 6
Varianti possibili: 81
Punteggio massimo: 18
```

Seguono una sezione «Domande comuni» e card «Gruppo N — una domanda estratta». Ogni card mostra alternative, tipo, difficoltà, punti, azione Rimuovi, «Aggiungi alternativa» ed «Elimina gruppo». Niente drag-and-drop.

Su mobile le stesse sezioni sono impilate; riepilogo e azioni occupano la larghezza disponibile senza tabella orizzontale.

### Una sola alternativa

Un gruppo può contenere una sola domanda. Non blocca creazione o attivazione e mostra:

> **Una alternativa possibile** — questa domanda sarà assegnata a tutti gli studenti.

Se l'intera configurazione produce una sola combinazione:

> **Una sola variante possibile.** La verifica funzionerà normalmente, ma tutti gli studenti riceveranno le stesse domande in ordine casuale.

Un gruppo vuoto viene eliminato automaticamente. Numero basso di combinazioni o ripetizione tra studenti sono warning non bloccanti.

### Validazioni bloccanti

Solo problemi che impediscono un compito coerente:

- riferimento a domanda inesistente/corrotto;
- alternativa incompatibile con il gruppo;
- nessuna domanda complessiva;
- snapshot non costruibile.

Non sono bloccanti: una sola alternativa, una sola combinazione o combinazioni inferiori al numero di studenti.

### Assegnazione e sicurezza

Al primo avvio una Cloud Function:

1. verifica studente, classe, stato e disponibilità online;
2. legge il teacher snapshot congelato;
3. assegna tutte le comuni e una alternativa per gruppo;
4. persiste una sola volta gli `order` assegnati nella consegna;
5. restituisce solo la proiezione senza soluzioni delle domande assegnate.

Refresh e nuovo login mantengono le domande assegnate; solo l'ordine visivo può cambiare. Lo studente non può rileggere alternative non assegnate modificando le chiamate. Nessuna copia completa dei pool, nessun documento per domanda, nessun listener o polling.

### Pacchetti

| ID | Scope | DoD |
|---|---|---|
| VEX-00 | Contratto gruppi + prototipo builder desktop/mobile. | Tutti gli stati, warning e validazioni rappresentati; approvazione docente. |
| VEX-01 | Modello dati, Function, assegnazione persistente e sicurezza. | Test concorrenza/idempotenza, isolamento alternative e refresh. |
| VEX-02 | Builder docente e flusso studente. | Correzione manuale/IA e restituzione lavorano sulla variante assegnata. |
| VEX-03 | Hardening equità/costi/smoke. | Gate multi-studente, nessuna fuga di alternative/soluzioni. |

## 7. VISUAL-BOOST — evoluzione grafica controllata

### VISUAL-BOOST-00

Solo prototipo statico, nessun codice applicativo. Deve rappresentare:

- Didattica;
- Verifiche;
- workspace lezione;
- dialog IA calibrato;
- appunti post-it;
- builder varianti desktop/mobile.

Direzione vincolante: tre livelli di superficie, accenti brand sottili, tabelle più vive, stati vuoti curati, transizioni CSS 120–150ms, niente blur pesante, font/asset/librerie nuove o cambi strutturali.

### VISUAL-BOOST-01

Implementazione solo delle scelte approvate sul prototipo, in pacchetti piccoli e reversibili. Ogni modifica deve mantenere layout, responsive, accessibilità e costi invariati.

## 8. Ordine di esecuzione

1. SPINNER-FIX-01;
2. M5-QUALITY-01;
3. M5-QUALITY-02 benchmark;
4. Gate G7 e chiusura M5;
5. POOL-SIMPLE-00;
6. POOL-SIMPLE-01;
7. POOL-SIMPLE-02;
8. Gate GPOOL;
9. ANNOT-00 → ANNOT-02 → Gate GANNOT;
10. VEX-00 → VEX-03;
11. VISUAL-BOOST-00;
12. VISUAL-BOOST-01 dopo approvazione esplicita.

POOL-SIMPLE precede obbligatoriamente VEX: i gruppi equivalenti vengono progettati e implementati soltanto sul contratto senza `peso` e con difficoltà 1–5.
