# Upgrade didattico: lezioni, correzioni, mappe e immagini

## Scope approvato — issue #524

Base: `31c826d114e313dd7976ebb51053272bafd4910c`. Rilascio autorizzato solo DEV.
Esercizi svolti, nuove impostazioni, nuove chiamate runtime, motori grafici e revisione
visiva delle immagini sono esclusi. Nessuna modifica automatica alle lezioni esistenti.

## Audit e modifiche

- Lezioni: le istruzioni esistenti già chiedevano progressione ed esempi verificabili.
  Ora l’esempio deve chiarire la scelta del metodo/confronto, i passaggi e il significato
  del risultato; dettagli e condizioni non vanno compressi per far spazio agli esempi.
  La forma si adatta alla disciplina, senza quote o sezioni obbligatorie.
- Revisore lezione: restituisce il corpo completo correggendo difetti specifici;
  conserva parti valide anche se migliorabili nello stile. Maggiore brevità non è un
  miglioramento. Niente sezioni sugli errori comuni, attività o autoverifiche.
- Percorso Economy/rollback: rimosse durata di un’ora, attività/autoverifiche e
  richieste di errori tipici; restano spiegazioni profonde e perimetro UDA.
- Correzioni: equivalenze, riferimento non esaustivo e credito parziale erano già
  presenti. Ora vengono distinti errori trascinati e nuovi errori indipendenti.
  Feedback specifico sul passo da correggere solo se esiste una lacuna; conferma
  motivata per risposte pienamente corrette, anche nel feedback generale.
- Mappe: lettura soggetto → relazione → oggetto, verifica della direzione e delle
  condizioni, nessuna causalità inventata; fusione solo di nodi davvero equivalenti
  per significato e ruolo. Formato testuale/ASCII esistente conservato, niente Mermaid.
- Immagini: scelta dell’ancora dal testo della sezione, non da parole nel titolo;
  didascalia indica cosa osservare e il legame col concetto, senza inventare dettagli.
  Spiegazioni lunghe fuori dall’immagine, solo etichette autorizzate indispensabili.

## Contratti e limiti

Modelli, listini, output limit, schemi JSON, contabilizzazione, valutazione doppia e
controllo/ack del docente invariati. Le istruzioni del correttore rimangono sotto
8.000 caratteri, eliminando duplicazioni senza rimuovere i criteri sostanziali.

Versioni: `lesson-explanations-v1`, `lesson-depth-explanations-v1`, `lesson-review-v4`,
`concept-map-relations-v1`, `concept_map_review-v5`, `visual-proposal-01-v8`,
`visual-plan-proposal-02-v3`. Pool e pool_review invariati.
Il contratto del correttore cambia automaticamente tramite digest delle istruzioni.

Le versioni visuali ora partecipano alla forma canonica come gli altri prompt:
nuove richieste non riusano run prodotti da istruzioni obsolete. Non vengono migrate
né eliminate operazioni o materiali salvati. Un retry di un vecchio run può richiedere
una nuova richiesta anziché riutilizzare la precedente identità.

I controlli sui prompt non dimostrano da soli maggiore qualità didattica. Il confronto
reale e il collaudo umano devono verificare assenza di impoverimento e correttezza.
Nessun controllo visivo dell’immagine prodotta viene introdotto in questo incremento.

## Confronto reale e revisione indipendente

Baseline congelata su `31c826d`, candidato compilato `f0dcc3d`. Dodici coppie con
gli stessi input e modelli: densità Completa/Approfondita, informatica Approfondita,
storia Economy Sintetica, revisione densità, correzioni matematica/scienze/informatica,
generazione e revisione mappa, piano immagini RAM e sezioni con titoli ripetuti.
Ventiquattro chiamate validate, nessun retry o errore; costo totale 0,397688 USD
entro il limite di 3 USD. Nessun dato studente o chiamata PROD.

Il revisore indipendente ha letto soltanto coppie A/B anonime prima di conoscere
il mapping. Preferenze: candidato in sette casi, baseline nella revisione densità,
quattro equivalenze; nessuna regressione materiale bloccante dimostrata.
Il candidato migliora interpretazione degli esempi, feedback sulle lacune e
didascalie; entrambi i piani con titoli ripetuti scelgono ancore corrette.
La preferenza per la revisione baseline riguarda soprattutto il richiamo alla
lezione successiva, senza una perdita sostanziale dei concetti nel candidato.

Limiti: campione piccolo, senza stabilità statistica o prova di apprendimento.
La bozza revisionata è breve e contiene errori: non dimostra la conservazione
di ogni dettaglio in un testo ricco già valido. Manca un holdout esplicito con
nuovo errore indipendente dopo errore trascinato e un batch interamente corretto
per il feedback generale. Non sono state generate né ispezionate immagini raster:
il confronto riguarda proposte, ancore, didascalie ed etichette.

Payload, output validati, costi e coppie sono in
[`evidenze/didactic-upgrade-2026-10/summary.json`](evidenze/didactic-upgrade-2026-10/summary.json).
Il metodo di confronto segue criteri specifici e revisione indipendente descritti
nella [documentazione ufficiale OpenAI](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

## Deploy mirato e rollback

Functions DEV: `aiContentPreview`, `aiContentGenerate`, `aiContentPromptExport`,
`aiCorrectionPreview`, `aiCorrectionRun`, `aiVisualPlanAuthorize`.
Nessuna modifica hosting, Rules, indici o dati cloud necessaria per questo incremento.
Rollback: ripristino dei componenti da `31c826d`; nessuna cancellazione di run o dati.
L’orchestratore registra SHA finale, CI, confronto reale, deploy e smoke prima di
annunciare il rilascio. PROD escluso.

## Collaudo docente

1. Generare lo stesso argomento in Sintetica, Completa e Approfondita: spiegazioni,
   dettagli e passaggi preservati, esempi motivati; nessuna sezione errori comuni o
   autoverifica. Provare Economy e Quality.
2. Ripetere con revisore ON/OFF e indicazioni aggiuntive: il revisore corregge
   problemi senza comprimere le parti valide; salvataggio e riapertura funzionano.
3. Correggere risposte sintetiche complete, alternative valide, parziali, un errore
   trascinato con passaggi coerenti e uno con nuovo errore indipendente; verificare
   punteggi proporzionati e feedback specifico, non suggerimenti inventati ai pieni.
4. Generare/revisionare una mappa: direzione e significato delle relazioni, condizioni
   conservate e concetti simili ma distinti non fusi.
5. Aggiungere immagini a una lezione con titoli simili: sezione pertinente,
   didascalia utile, etichette minime. Verificare anche generazione completa e retry.
