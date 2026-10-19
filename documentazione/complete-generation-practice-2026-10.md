# Generazione completa: revisore lezione ed esercitazioni opzionali

Base main 698bc40. Unico writer su fix/complete-generation-practice. Issue e PR uniche; root gestisce review, merge e DEV.

- lesson_review usa la policy timeout dedicata della lezione (180s predefiniti), con lease derivata dalla stessa policy, callable420s/client450s già sufficienti. Diagnostica provider con soli kind, fase e motivo allowlist; accounting invariato.
- Popup completa: esercitazioni opzionali ON, 6 attività predefinite, card3/6/9 accessibili nello stile esistente. Ordine: corpo finale revisionato, mappa, pratica, pool, immagini. Revisione avanzata unica per tutti gli artefatti.
- Pratica tramite slot pipeline esistente. Stima e conferma distinte prima di generazione e revisione, nel popup. Le attività validate sono salvate soltanto come bozza privata, publish:false. Nessuna esposizione studente o approvazione automatica.
- Il pool riceve draftPractice: contesto provvisorio non approvato e subordinato alla lezione. Campo chiuso/bounded incluso in prompt, stime e hash; approvedPractice rimane riservato ai contenuti approvati.
- Checkpoint additivo: ID stabili, candidato base e risultato revisionato della pratica, flag salvataggio e rischio costi. Cache con campi canonici senza feedback transiente; validazione completa contro corpo corrente al ripristino. Cambio fonte invalida. Legacy senza opzione pratica riprende con pratica disattivata. Retry review/save non richiama generazione. Mappe/pool usano il replay server con ID stabile già esistente.
- Costi: risultati noti separati, consumo incerto dopo invocazione fallita rende totale non disponibile. Nessuna certezza fittizia. Errori preview non marcano consumo.

Gate: timeout/lease/accounting/log sanitizzati; toggleOFF e3/6/9; corpo finale; draftPractice→pool; review e save failure/retry/reopen/idempotenza; checkpoint legacy e cambio fonte; UI desktop/mobile; format/lint/typecheck/test/build/diff e CI completa. Provider reali/secret esclusi dal writer; solo root gestisce eventuale budget sintetico autorizzato6calls/1USD. Nessun deploy PROD.
