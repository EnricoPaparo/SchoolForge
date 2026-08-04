# LESSON-TUNE-01 — protocollo di tuning controllato

## Obiettivo

Migliorare il prompt di generazione delle lezioni sulla base di difetti
pedagogici **ricorrenti e osservabili**, senza ottimizzarlo sui singoli esempi.
La rubrica autorevole resta `lesson-manual-02-rubric-v1`.

## Dataset e separazione

Il benchmark combina i 6 scenari congelati di LESSON-MANUAL-02 con i 6 scenari
di `lesson-tune-01-extension-v1`:

- **tuning (8):** LM02-01..04 e LT01-07..10;
- **holdout (4):** LM02-05..06 e LT01-11..12.

Gli scenari tuning coprono teoria introduttiva, procedura tecnica, esempi,
esercizi svolti, analisi di fonti, correzione di misconcezioni, debugging e
argomentazione. Gli holdout verificano generalizzazione su approfondimento
tecnico, rispetto del confine UDA, calcolo scientifico e modellazione di
sistemi.

## Regola anti-overfitting

1. Si genera e valuta il solo split `tuning` col prompt corrente.
2. Si classificano i difetti come prompt, renderer, metadati, variabilità o
   correttezza disciplinare da verificare.
3. Il prompt si modifica solo per un difetto controllabile dal prompt che:
   - ricorre in almeno 2 scenari; oppure
   - produce un blocker di sicurezza, correttezza o perimetro.
4. La modifica deve essere generale: non può citare discipline, titoli, esempi
   o formulazioni appartenenti al dataset.
5. Si rigenerano gli 8 scenari tuning con il candidato e si confrontano
   dimensione per dimensione con la baseline.
6. Solo quando il candidato è congelato si esegue **una volta** lo split
   `holdout`. Gli output holdout non possono motivare un'altra modifica dello
   stesso candidato: se falliscono, il candidato è respinto e inizia un nuovo
   ciclo dichiarato.

## Valutazione

Per ogni campione sono obbligatori:

- i 15 punteggi della rubrica con evidenze osservabili;
- controllo separato di correttezza disciplinare da parte del docente;
- mappa `obiettivo → sezione/esempio/attività`;
- nota sulla progressione: prerequisito, concetto nuovo, applicazione,
  trasferimento;
- nota su misconcezioni prevenute o lasciate implicite;
- controllo del perimetro rispetto alle lezioni precedenti e successive;
- prova nelle viste reali docente e studente.

Non basta che una lezione sia lunga, gradevole o formalmente ordinata. Deve
rendere praticabili gli obiettivi, spiegare i nessi causali e i passaggi,
calibrare il carico cognitivo e non insegnare fatti falsi.

## Sequenza economica consigliata

1. baseline tuning: 8 chiamate;
2. candidato A tuning: 8 chiamate;
3. holdout finale: 4 chiamate;
4. un secondo candidato solo se A mostra un difetto ricorrente: altre 8.

Nessuna ripetizione automatica: si ripete soltanto un caso borderline quando
serve distinguere un difetto sistemico dalla variabilità del modello. Ogni
esecuzione reale richiede una nuova autorizzazione esplicita dopo il dry-run.

## Stato

Dataset e protocollo congelati. Baseline `tuning` reale completata il 4 agosto
2026: 8/8 campioni, costo 33.237 µUSD, zero Firestore/Storage. La review tecnica
ha prodotto **REVISIONE_SOSTANZIALE** e il candidato A
`lesson-tune-01-candidate-a-v1`; resta obbligatoria la conferma disciplinare del
docente. I 4 `holdout` non sono stati eseguiti e non possono essere usati prima
del congelamento del candidato. Evidenze in
[`lesson-tune-01-baseline-review.md`](lesson-tune-01-baseline-review.md).
