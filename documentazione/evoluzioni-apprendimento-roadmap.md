# SchoolForge — Roadmap evoluzioni apprendimento e varianti

**Stato:** decisioni UX/prodotto approvate; implementazione non avviata.  
**Data baseline:** 18 luglio 2026.  
**Dipendenze:** UI-POLISH-01 completato; M5 operativo su DEV e **Gate G7 PASS**.

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

Calibrazione strutturata implementata. `gradingMode` (`compassionate` | `balanced` | `rigorous`, default `balanced`) attraversa in modo tipizzato UI → client → preview → run → engine → `AiGraderInput` → prompt OpenAI, ed entra nell'hash di selezione (idempotenza): stesso `requestId` con stile o indicazioni diversi ⇒ `invalid_input`, e la UI genera una nuova `requestId` a ogni modifica. `gradingMode` assente — cioè **proprietà omessa** (`undefined`) — ⇒ normalizzato a `balanced`; valore presente ma non valido, incluso `null`, ⇒ `invalid_input`. Il limite delle indicazioni docente è 500 caratteri. Il benchmark e la revisione successivi sono conclusi con **Gate G7 PASS**; vedi [`evidenze/g7-m5-checklist-finale.md`](evidenze/g7-m5-checklist-finale.md).

### M5-QUALITY-02 — benchmark

Le stesse risposte sintetiche vengono corrette nelle tre modalità. Il gate richiede differenze osservabili e coerenti nella fascia giustificabile, senza trasformare risposte errate in corrette. Il modello non cambia prima di questa evidenza.

### Stato — M5-QUALITY-02-FIX IMPLEMENTED, SECOND BENCHMARK REQUIRED

Il primo benchmark reale autorizzato è stato eseguito sul solo dataset sintetico: 36 chiamate pianificate, modello pinned, tre ripetizioni. L'ordine aggregato (`compassionate` 41, `balanced` 39,001, `rigorous` 37,75 su 53) è coerente, ma il verdetto è `AUTOMATIC_CHECKS_FAILED`: SCI-003 è stata sovrastimata, SCI-002 ha penalizzato un'alternativa scientificamente valida e INF-007 ha mostrato una violazione della fascia nel caso prompt injection. Il comparatore produceva inoltre falsi positivi perché applicava la stessa fascia congelata a tutte le modalità.

M5-QUALITY-02-FIX ha introdotto fasce mode-aware di ±0,50 esclusivamente per casi graduabili, invarianti per casi chiaramente corretti/errati e separazione fra errori sistematici, oscillazioni e `requiresTeacherReview`. I benchmark successivi, la rivalutazione offline e la revisione docente sono conclusi; **M5-QUALITY-02 è chiuso nel Gate G7 PASS**. Evidenze: [`evidenze/m5-quality-02-benchmark.md`](evidenze/m5-quality-02-benchmark.md) e [`evidenze/g7-m5-checklist-finale.md`](evidenze/g7-m5-checklist-finale.md).

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
| POOL-SIMPLE-01 | ✅ Contratto V2, parser/serializer/tipi/fixture e template/kit implementati. | Pool V2 validi 1–5; `peso` rifiutato; tutti i template importabili. |
| POOL-SIMPLE-02 | ✅ Editor, index, picker, snapshot, PDF/restituzione/IA privi di `peso`; ponte `peso: 1` rimosso, `maxPoints === difficolta`, test end-to-end di contratto e payload IA. **Implementato.** | Nessuna UI o payload nuovo espone `peso`; maxPoints sempre uguale a difficoltà. |
| Gate GPOOL | ✅ **PASS (20 luglio 2026).** Audit del flusso import→verifica→svolgimento→correzione→restituzione/export, con evidenze automatiche, rollout DEV dichiarato e rifiuto V1 osservato dal docente. Vedi [`evidenze/gpool-checklist-finale.md`](evidenze/gpool-checklist-finale.md). | Contratto V2 verificato end-to-end; limiti manuali residui esplicitati nell'evidenza. |

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

Campi minimi (ANNOT-01, definitivi): `studentUid`, `publicLessonId`, `programId`,
`importId`, `content`, `createdAt`, `updatedAt`. Il campo `lessonId` proposto in
ANNOT-00 è stato rimosso: `PublicLessonDoc` non ha un campo `lessonId`, l'identità
canonica della lezione è l'ID documento `publicLessonId` (vedi
`student-notes-contract.md` §4).

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
| ANNOT-01 ✅ | Service e Rules. **Implementato** (tipo definitivo, service, Rules, test unitari + Emulator). | Test Emulator su ownership, classe e modalità verifica: superati. |
| ANNOT-02 ✅ | Pannello desktop, vista mobile e stati di salvataggio. **Implementato** (comando Appunti, `useLessonNotes`, `LessonNotesPanel`, cache di sessione, dirty guard, test componente/hook). | Smoke desktop/mobile; nessun accesso docente o durante verifica: coperti da test; smoke DEV in ANNOT-03. |
| ANNOT-03A ✅ | Rifinitura UX Appunti e focus lezione desktop. **Implementato:** Salva esplicito desktop/mobile, `Ctrl/Cmd+S`, stati leggibili, contrasto/selezione locale, comando `Nascondi/Mostra struttura` solo desktop e stato locale. | Nessuna lettura/scrittura, Rule, query, listener o persistenza aggiuntiva; regressioni Appunti/Didattica coperte da test mirati. |
| ANNOT-03B ✅ | Indice per corso, bootstrap controllato, batch atomici nota+indice, matita persistente desktop/mobile, pulsante evidenziato, footer stabile e post-it RGBA 90%. **Implementato.** | Una read indice per corso/sessione; nessuna read per lezione, listener o polling; Rules e regressioni coperte da test. |
| Gate GANNOT ✅ | Evidenze funzionali, sicurezza e costo. **Superato (PASS)** — matrice completa in `evidenze/gannot-checklist-finale.md`; ANNOT-03B su DEV, suite Rules verde 476/476. | Checklist docente/studente completa. |

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
| VEX-00B ✅ (docs+prototipo) | Consolidamento tecnico (inventario del già-implementato, congelamento nomi campi, contratto assegnazione/sicurezza/costo/PDF/correzione) + prototipo statico. | [`vex-contract.md`](vex-contract.md) e [`prototipi/vex-builder.html`](prototipi/vex-builder.html); nessun codice applicativo/Function/Rule/indice/schema/dipendenza/deploy. |
| VEX-01A ✅ (client) | Modello dati + builder draft-time + helper puri (normalizzazione modalità, riconciliazione gruppi, conversione entryId→order) + guardia fail-closed di attivazione. | `distributionMode`/`equivalentGroups` in config, `questionsPerStudent` rimosso, validazioni bloccanti/warning, `same_questions` invariato. **VEX non operativo:** `activateVerification` rifiuta `equivalent_variants` finché VEX-01B non aggiunge callable+isolamento. Nessuna Function/Rule/indice/schema reale. |
| VEX-01B ✅ | Attivazione `equivalent_variants` operativa + callable `assignVerificationVariant` (RNG sicuro, transazione idempotente) + isolamento + Rules server-only. | Test concorrenza/idempotenza, isolamento alternative, refresh; proiezione **solo comuni**; unica scrittura `assignedQuestionOrders`; guardia VEX-01A rimossa. **VEX non ancora operativo end-to-end**: UI studente a VEX-02. |
| VEX-02A ✅ | Svolgimento studente della variante assegnata. | Routing fail-closed su `distributionMode`; avvio/ripresa/refresh via callable idempotente; `OnlineExamView` solo variante; autosave/consegna ristretti (client + Rules `answers ⊆ assignedAnswerKeys`); PDF studente disabilitato in VEX; `same_questions` invariato (nessuna callable). |
| VEX-02B ✅ | Correzione/IA/restituzione/export sulla sola variante. | Risolutore canonico `resolveAssignedQuestions`; fonte modalità esclusiva `teacherSnapshot.distributionMode` (solo assenza legacy → `same_questions`); scheletro correzione + totali + return + payload IA sulla variante validata fail-closed; IA esclude consegne a variante malformata; PDF docente completo invariato, registro/CSV su totali variante. |
| VEX-03 | Hardening equità/costi/smoke. | Gate multi-studente, nessuna fuga di alternative/soluzioni. |

Il contratto tecnico completo (campi definitivi, assegnazione/idempotenza, sicurezza,
costi, PDF, correzione, scope per pacchetto) è congelato in
[`vex-contract.md`](vex-contract.md). VEX-00B è **solo documentazione + prototipo**.

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
8. Gate GPOOL ✅ PASS;
9. ANNOT-00 → ANNOT-03A → ANNOT-03B → Gate GANNOT;
10. VEX-00 → VEX-03;
11. VISUAL-BOOST-00;
12. VISUAL-BOOST-01 dopo approvazione esplicita.

POOL-SIMPLE precede obbligatoriamente VEX: i gruppi equivalenti vengono progettati e implementati soltanto sul contratto senza `peso` e con difficoltà 1–5.
