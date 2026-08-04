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
ha prodotto **REVISIONE_SOSTANZIALE**. Il candidato A è stato poi eseguito sugli
stessi 8 casi (35.026 µUSD): ha eliminato il LaTeX ma conserva due blocker di
correttezza, quindi è respinto. Il candidato B è stato eseguito sugli stessi
otto casi (33.597 µUSD): corregge i due blocker precedenti ma introduce una
contraddizione centrale fra massa e forza peso e resta respinto. Il candidato C
è stato eseguito sugli stessi otto casi: sette costi noti sommano 27.618 µUSD,
mentre `LT01-09` ha billing risk e impedisce di dichiarare un totale effettivo;
il tetto prudenziale è 218.798 µUSD. C corregge il blocker di B ma fallisce su
un esercizio IPv4 con premesse incompatibili. Il candidato D
`lesson-tune-01-candidate-d-v1` aggiunge audit generale di compatibilità delle
premesse e precisione terminologica. Test e dry-run D sono verdi: 8 chiamate,
massimo 16 tentativi, stima 94.084 µUSD e tetto prudenziale 221.610 µUSD; zero
secret e zero rete. I 4 `holdout` non sono stati eseguiti e non possono essere
usati prima del congelamento del candidato.
Evidenze: [`lesson-tune-01-baseline-review.md`](lesson-tune-01-baseline-review.md)
[`lesson-tune-02-candidate-a-review.md`](lesson-tune-02-candidate-a-review.md) e
[`lesson-tune-03-candidate-b-review.md`](lesson-tune-03-candidate-b-review.md),
[`lesson-tune-04-candidate-c-review.md`](lesson-tune-04-candidate-c-review.md).

## Confronto modello sul candidato D

Il candidato D è stato eseguito 8/8 su `economy`: sette costi noti sommano
29.510 µUSD; `LM02-04` ha billing risk, quindi il totale reale non è
determinabile; tetto prudenziale 221.610 µUSD. Due blocker (`LM02-02` IPv4 e
`LM02-03` trasferimento termico) dimostrano che aggiungere altre istruzioni al
prompt non è il prossimo esperimento informativo. Review completa:
[`lesson-tune-05-candidate-d-review.md`](lesson-tune-05-candidate-d-review.md).

Il runner accetta ora il profilo server-side `quality` **solo** insieme allo
split `tuning`:

```powershell
pnpm --filter @schoolforge/functions build
pnpm --filter @schoolforge/functions benchmark:lesson-tune-quality -- --benchmark-split=tuning --benchmark-model-profile=quality
```

Dry-run quality del 4 agosto 2026: `gpt-5.6-luna`, listino
`v5-2026-07-20-luna-dev`, 8 chiamate, massimo 16 tentativi, stima
451.904 µUSD (0,451904 USD), tetto prudenziale 1.070.842 µUSD (1,070842 USD),
zero secret e zero rete. Modello/listino sono risolti esclusivamente dal
profilo chiuso; il client non passa identificatori tecnici.

L'esecuzione reale quality richiede gli stessi due flag, Node 22, TTY, chiave
letta per ultima e la frase distinta `ESEGUI 8 LEZIONI TUNING REALI QUALITY`.
Il profilo quality con split `all` o `holdout`, valori sconosciuti e flag
duplicati vengono rifiutati prima di chiave e provider. Nessuna autorizzazione
reale è concessa da questo documento.

Il confronto reale quality è stato completato 8/8 il 4 agosto 2026. Sette
costi noti sommano 150.771 µUSD; `LM02-04` ha billing risk, quindi il totale
effettivo non è determinabile; tetto prudenziale 1.070.842 µUSD. Tutti gli otto
scenari sono `PASS`, senza blocker: verdetto tuning **PROMPT_INVARIATO** sul
profilo quality. Review completa:
[`lesson-tune-06-quality-review.md`](lesson-tune-06-quality-review.md).

I quattro holdout restano ineseguiti e il runner continua a rifiutare
`quality + holdout`. L'eventuale apertura di quel percorso richiede una modifica
separata, un nuovo dry-run e una nuova autorizzazione economica; i risultati
holdout non potranno essere usati per ritoccare il candidato congelato.
