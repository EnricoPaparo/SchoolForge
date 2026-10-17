# Esercitazioni: riferimenti e revisore dedicato

Issue #544. Base `1257935`. Implementazione nel ramo `fix/study-practice-review-flow`.

La generazione pratica usa il contratto provider `study-practice-v3`: la fonte completa viene suddivisa in estratti deterministici, senza normalizzazioni, omissioni o duplicazioni. I riferimenti interi vengono risolti dal server in citazioni esatte prima del validatore canonico. Copertura preparata/parziale richiede un riferimento valido; obiettivi non sviluppati richiedono null. Test riproducono le combinazioni precedentemente ammesse dallo schema ma rifiutate da `coverage_evidence`. Diagnostica limitata a codici sanitizzati. Fonte inferiore a 20 caratteri rifiutata prima del provider.

Il ramo `pool_review` con `purpose=practice` richiede domande e piano canonico completi, con identità `practice-review-v1` e modello Sol della policy esistente. Il revisore controlla metodi, soluzioni, aiuti, progressione e copertura. Restituisce l'intero percorso; la risoluzione dei riferimenti e la validazione canonica sono obbligatorie. Un esito fonte insufficiente blocca l'applicazione. Persistenza StudyPlan/StudyPractice v1 e lettura delle revisioni pool legacy restano compatibili. Non sono necessarie migrazioni o modifiche Rules.

Il popup propone revisione avanzata attiva, disattivabile nella configurazione. Dopo la generazione mostra una stima distinta del revisore e richiede conferma prima di avviarlo. Errori e retry conservano la bozza base e l'identità del revisore; nessuna applicazione della base se la revisione fallisce. Le card 3/6/9 conservano radio native accessibili, nascoste visivamente, e focus visibile.

Verifica locale: 237 test Functions mirati, inclusi retry con porte gateway reali e ledger in memoria per output invalido e invocazione incerta, successivo successo e replay senza doppia spesa. 8 test popup coprono conferma costo, retry della sola revisione, assenza di applicazione prematura e invalidazione su cambio fonte. Suite Functions completa: 2260 passati, 223 integrazioni emulatori escluse. Typecheck workspace e lint verdi. Gate web completo/build/CI e review indipendente vengono registrati dall'orchestratore sullo SHA finale.

Il collaudo reale è eseguito solo dall'orchestratore, con autorizzazione separata fino a 6 chiamate e 1 USD su sintetici. Primo checkpoint `3cea975`: generazione 6 attività Markdown/Unicode e obiettivo scoperto completata, riferimenti e validatore canonico superati; costo 0,001957 USD. Ulteriori evidenze nel ledger esterno TEMP `schoolforge-practice-review-flow-real-smoke`, senza chiavi. Questo campione non garantisce correttezza semantica universale: i riferimenti provano la provenienza, il revisore resta un controllo IA e il docente approva prima della pubblicazione.

Rilascio gestito dall'orchestratore dopo CI e review: solo DEV, Hosting e callable contenuti esistenti interessate; nessun deploy PROD.
