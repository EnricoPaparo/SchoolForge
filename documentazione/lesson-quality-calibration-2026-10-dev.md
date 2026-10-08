# Calibrazione didattica delle lezioni — issue #526

## Contratto e motivazione

Base `240703454a06624a592301eb146cf579232e5f1c`. Autorizzato sviluppo e DEV,
PROD escluso. Generatore, schemi, limiti, interfaccia e contabilizzazione
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

Esiti reali, SHA, costi, gate, deploy e smoke verranno registrati dall’orchestratore
prima della chiusura del task.
