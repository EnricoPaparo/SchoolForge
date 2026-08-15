# VDIF-05 — audit dei consumer downstream

**Stato:** automatico PASS; rollout DEV e Gate GVDIF **PENDING**.

Questo documento registra il confine verificato dal codice. Non sostituisce lo
smoke multi-studente richiesto da GVDIF.

| Superficie | Fonte autorevole | Evidenza | Esito |
|---|---|---|---|
| Svolgimento online | risposta sanitizzata di `assignVerificationVariant` + `assignedQuestionOrders` persistiti | test callable, Rules e `vexExamService` | solo domande assegnate; errori studente opachi |
| Salvataggio e consegna | `assignedAnswerKeys` server-only | Rules emulator VEX/VDIF | risposte e flag estranei negati |
| Correzione manuale | `resolveAssignedQuestions(teacherSnapshot, submission)` | fixture con order non contigui e base omessa | scheletro, punteggio massimo e navigazione sulla sola assegnazione |
| Correzione IA | `parseResolvableSnapshot` + `isValidResolvedAssignment` nelle Functions | sentinella in etichetta, base e soluzione non assegnata | il grader non riceve né la base né la sentinella; snapshot incoerente escluso prima del provider |
| Restituzione | snapshot docente congelato filtrato dal resolver | test `returnCorrection` con sostituzione | solo domanda, risposta, valutazione e soluzione assegnate |
| Review studente | `CorrectionReturnDoc` | test di rendering con order non contigui | numerazione locale 1…N, nessun order tecnico mostrato |
| PDF archivio/correzione | modello archivio filtrato dal resolver | test del modello e PDF esistenti | solo domande assegnate; numerazione locale |
| PDF verifica docente | snapshot completo owner-only | contratto esistente | resta il documento completo del docente |
| PDF verifica studente | callable personale + assegnazione server-only | test core, UI, client e Rules | solo domande assegnate; nessuna submission creata dal download e nessuna esposizione del compito completo |
| CSV registro | riepiloghi della correzione | test export esistenti | soli totali/esiti, nessuna domanda o etichetta |
| Ricevute | contratto chiuso `SubmissionReceiptDoc` | test strutturale sui tipi e Rules esistenti | nessun campo di differenziazione |
| Chiusura forzata | submission già assegnata | test strutturale + suite Functions | conserva l'assegnazione; non serializza etichette |
| Argomenti | `topicOutline` comune congelato | contratto VDIF-04 | identico per tutti, non rivela la variante |
| Audit/log/run IA | soli dati tecnici e aggregati previsti | sentinella assente da run/eventi e test strutturali | nessun nome/id etichetta o motivo della selezione |

## Decisioni visibili

- Gli `order` canonici restano chiavi tecniche per risposte e valutazioni, ma
  docente e studente vedono sempre una sequenza locale densa `1…N`.
- Una verifica `same_questions` con `differentiation` è **server-resolved** come
  una VEX: il vecchio ripiego sulla proiezione comune o sull'intero snapshot è
  vietato.
- Nessun consumer post-attivazione legge `differentiationLabels` o
  `studentLabelAssignments`: lo snapshot congelato è autosufficiente.
- I test usano una sentinella riconoscibile nel nome dell'etichetta e in una
  domanda non assegnata. La sentinella non compare nel payload del grader,
  nella correzione restituita né negli artefatti studente.

## Costo

VDIF-05 aggiunge **zero** letture, scritture, callable, listener, polling,
documenti o indici. Correzione manuale, IA, restituzione ed export filtrano dati
già caricati. Il costo della correzione IA resta quello del solo contenuto
assegnato e può quindi essere inferiore al vecchio invio dello snapshot intero.
