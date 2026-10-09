# Calibrazione didattica delle lezioni — issue #526

> **Allineamento 9 ottobre 2026:** stato applicativo, modelli e rilascio DEV/PROD
> in [stato-release-2026-10.md](stato-release-2026-10.md). Le date, i gate,
> prezzi e limiti di autorizzazione delle fasi riportate sotto sono storici;
> non sostituiscono la policy corrente e non autorizzano nuovi sviluppi/deploy.

## Contratto e motivazione

Base `240703454a06624a592301eb146cf579232e5f1c`. Autorizzato sviluppo e DEV,
PROD escluso. Modelli del generatore, schemi, limiti, interfaccia e contabilizzazione
rimangono invariati; pool, mappe, immagini ed esercizi svolti non sono in scope.

Il confronto holdout precedente è misto: 3 preferenze per il candidato DEV,
2 per la baseline e una parità. Nessuna superiorità generale dimostrata.
La matematica precedente motivava meglio il metodo, il controllo nell’enunciato
iniziale e le soluzioni ammissibili. Un esempio biologico candidato era
fuorviante; il revisore attuale lo ha conservato pur dichiarando improved.
Il revisore nuovo aveva invece preservato bene due bozze ricche e valide.
Un singolo campione non dimostra frequenza degli errori o causa sistematica.

## Candidato mirato

- Generazione quantitativa: motivo del metodo, passaggi significativi,
  verifica nei dati/enunciato iniziali, vincoli e soluzioni ammissibili quando
  pertinenti. Nessuna quota universale di esempi o attività nuove.
- Esempi: verifica di premesse, meccanismo e conclusione rispetto ai principi
  disciplinari; non basta coerenza interna con un testo eventualmente errato.
  Una proprietà va valutata per il suo ruolo nel meccanismo prima di dedurre
  compatibilità o incompatibilità; correggere o sostituire casi non sostenibili
  preservando la spiegazione. Nessuna regola speciale sugli enzimi.
- Revisore: medesimi controlli, parti valide conservate; unchanged e body
  identico se non esiste un difetto concreto da riparare. La preferenza stilistica
  non giustifica improved. Motivazione aggiunta soltanto per passaggi mancanti
  necessari alla comprensione, senza rendere obbligatorie sezioni sugli errori.

Il solo revisore lezione usa ora `gpt-6.1-sol` con listino accoppiato
`v12-2026-09-29-gpt61-sol-standard`, per entrambi i profili. Il profilo scelto resta
nel run e nel risultato; Economy generatore resta 5.6 Luna. Pool e mappe restano
revisionati da 5.6 Luna. Nei test reali il controllo Luna ha conservato l’errore
biologico due volte; due prove Sol lo hanno corretto con conservazione del materiale
valido confermata da review indipendente. È una scelta fondata su quel difetto,
non una prova di superiorità generale.

Parametri nativi esistenti: reviewer Sol medium per Sintetica/Completa, high per
Approfondita; verbosity low/medium/high. Tetti 8.000/14.000/18.000 invariati.
Costo singolo probe biologico Sol 0,046286 e 0,035470 USD contro 0,005455 USD
Luna fallito: costo maggiore documentato, senza promessa di una tariffa fissa.
Preview e prenotazione usano la stessa policy e listino; limiti operativi restano
fail-closed. reviewPolicy modello/listino partecipa al nuovo inputHash.

Versioni candidate: `lesson-explanations-v2`, `lesson-depth-explanations-v2`,
`lesson-review-v5`, sincronizzate con canonicalRequest/inputHash. Cambiati solo
futuri prompt e identità replay; nessuna migrazione o riscrittura di lezioni salvate.
Bound offline aggiornati per includere byte effettivi del nuovo prompt.

## Gate e rilascio

Il rilascio richiede confronto reale con bozze problematiche e controlli validi,
review indipendente dello SHA definitivo e CI completa. Le evidenze devono
separare esecuzione tecnica, correttezza disciplinare e mantenimento didattico.
Nessuna conclusione di qualità universale dal campione piccolo.

Deploy DEV mirato: `aiContentPreview`, `aiContentGenerate`, `aiContentPromptExport`.
Hosting, Rules, indici e dati invariati. Rollback dei tre componenti alla base
`2407034`; nessuna eliminazione di run. PROD richiede nuova autorizzazione.

## Collaudo docente previsto

1. Matematica Approfondita: motivazione del metodo, verifica nell’equazione
   originale e distinzione tra risultati algebrici e ammissibili nel problema.
2. Biologia Completa: coerenza degli esempi col meccanismo spiegato; confronto
   revisore ON/OFF e nessun impoverimento delle spiegazioni valide.
3. Materia diversa e Sintetica: esempi proporzionati al taglio richiesto,
   nessuna attività/autoverifica o sezione sugli errori comuni obbligatoria.
4. Bozza già valida: revisore conserva dettagli, controlli e motivazioni utili.
5. Salva e riapri; generazione completa usa il corpo revisionato senza regressioni
   nelle fasi successive. Eventuale retry non rigenera le fasi già salvate.

## Prove reali e valutazione indipendente

L’8 ottobre 2026 sono state eseguite 25 chiamate reali su dati sintetici,
senza retry, errori provider o errori di validazione, per 0,776280 USD.
Payload effettivi, risposte e provenienza sono conservati in
[`evidenze/lesson-quality-calibration-2026-10/final-summary.json`](evidenze/lesson-quality-calibration-2026-10/final-summary.json).
Gli hash dei sorgenti e dei moduli compilati identificano il candidato congelato;
le modifiche successive a test e documentazione non cambiano quei payload.

Sei confronti fra DEV precedente e candidato, a parità di input, modello e
impostazioni: due ripetizioni di matematica e biologia, una di fisica e storia.
Le coppie anonime sono state valutate prima di rivelare le identità, secondo
criteri di correttezza, spiegazione dei metodi, condizioni e mantenimento dei
dettagli necessari. La lunghezza non attribuisce punteggio.

| Caso | Preferenza | Evidenza |
| --- | --- | --- |
| Matematica, campioni 1 e 2 | Candidato | Progressione concreta, controllo nell’equazione originale e vincoli del problema. |
| Biologia, campioni 1 e 2 | Candidato | Esempi meccanistici più concreti e specificità ben spiegata; entrambe le varianti corrette. |
| Fisica | Candidato, lieve | Interpretazione del risultato, incertezza sperimentale e limiti del generatore reale. |
| Storia | Baseline | Il candidato comprime impropriamente dichiarazione di guerra e bombardamento nella stessa data. |

Il nuovo revisore ha corretto l’esempio biologico problematico in due prove
sullo stesso testo, mentre Luna lo lasciava intatto anche dopo il primo tuning.
Ha conservato byte per byte le due lezioni ricche già valide di densità e informatica.
Nelle tre catene effettive generazione → revisione, matematica resta identica,
biologia riceve una sola precisazione sul bilancio energetico e storia corregge
la cronologia e altri passaggi circoscritti, preservando il materiale valido.
La review indipendente ha confermato questi esiti senza nuovi errori materiali.

Il difetto storico è verificato anche sul resoconto di Rauchensteiner,
[*The First World War*, p. 143](https://austria-forum.org/web-books/firstworldwar01en2014isds/000145):
la dichiarazione è del 28 luglio, il bombardamento avviene nella notte fra 28 e 29.
Questo caso mostra perché la sola generazione non basta a validare il materiale.

Le ultime due chiamate producono mappa di matematica e tre domande di biologia
dagli esatti corpi revisionati, con provenienza verificata mediante hash.
Validazione strutturale e review didattica indipendente entrambe PASS:
relazioni e formule della mappa coerenti; domande, soluzioni e credito parziale
aderenti alla lezione. Il rendering della mappa non è stato esaminato.
Non è una prova reale dell’intera UI, delle immagini raster o delle correzioni:
quei componenti non sono stati modificati. Il campione non dimostra qualità
universale, frequenza degli errori o apprendimento effettivo degli studenti.

Il maggior costo del revisore è reale: nei due casi biologici confrontabili
0,035470–0,046286 USD contro 0,005455 USD di Luna. Il costo varia con testo,
profondità, ragionamento e cache. La UI segnala già che la revisione ha un costo
separato: la stima iniziale riguarda il generatore, non un totale anticipato.

CI completa verde su `b129322`, inclusi i test Rules con Java 21. Gate locali
format, lint, typecheck, test, build e diff verdi; Rules locale non eseguibile
con la versione Java presente. La CI sul commit finale e la review indipendente
precedono merge e deploy. SHA distribuito, target e smoke vengono registrati
nella issue #526 dopo il rilascio.
