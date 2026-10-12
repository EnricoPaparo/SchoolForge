# EXAM-CLOSE-REVIEW-ORDER — contratto ed evidenze (12 ottobre 2026)

Issue: [#534](https://github.com/EnricoPaparo/SchoolForge/issues/534).
PR draft: [#535](https://github.com/EnricoPaparo/SchoolForge/pull/535).
Base: `35076fc45515481463607444d45643963baab777`; branch
`fix/exam-close-review-order`. Un solo writer; orchestratore responsabile di
review indipendente, merge e rollout. L'utente ha autorizzato implementazione,
test, DEV, PROD e smoke provider nel task corrente. Questa autorizzazione non
si estende a task futuri. L'implementatore non ha eseguito deploy, chiamate
provider, accessi ai secret o scritture cloud applicative.

## Contratto

1. Il countdown dello studente confronta la deadline Firestore originale con
   tempo server calibrato e tempo trascorso monotono (`performance.now`). Una
   callable autenticata `examServerTime` restituisce soltanto l'epoch server,
   senza letture database. Prefetch all'apertura dell'esame, aggiornamento ogni
   15 secondi, nuova calibrazione dopo visibility/pageshow/focus. Campioni lenti
   (>5 secondi) o non validi sono rifiutati; errori non creano una nuova deadline.
   Durante la sincronizzazione si mostra un messaggio senza countdown inventato
   e si permette di salvare. Il campione ricevuto è un limite inferiore al tempo
   server: il ritardo di rete non blocca anticipatamente. La task resta l'unica
   autorità sulla chiusura, con guard server `too_early` invariata. La latenza di
   rete può lasciare un piccolo ritardo di visualizzazione, mai dipendente dalla
   data del PC; una ricevuta chiude subito la vista anche prima dello zero UI.
2. Revisione avanzata ON: due chiamate. La seconda riceve domanda, risposta,
   riferimento/rubrica, criteri e prima proposta delimitata; corregge concretamente
   punteggi e feedback e restituisce la correzione finale nello stesso schema.
   Non si fa media e non si mantiene la prima proposta quando l'audit la corregge.
   Output invalido o audit fallito non applicano alcuna proposta parziale. Le
   ambiguity residue restano metadati informativi; il semplice cambiamento di
   punteggio non genera un disaccordo obbligatorio. OFF mantiene una sola chiamata.
   Input hash e prompt version distinguono `actionable-audit-v2`; checkpoint,
   lease, replay idempotente e accounting dei tentativi restano attivi. Il bound
   economico include l'intero payload audit, prima proposta con stringhe al limite
   ed escaping UTF-8/JSON, punteggi in quarti e retry; stima preview/run include
   l'overhead della proposta. Numero chiamate e budget configurati invariati.
3. Le quattro vecchie correzioni PROD con punteggi già presenti e marker
   `review_recommended` possono essere completate senza checkbox, ricalcolo,
   azzeramento o marker fittizi di `teacher_reviewed`/successo audit. Valori
   manuali e feedback restano invariati. Il nuovo audit riguarda nuove correzioni;
   non migra automaticamente bozze tecniche blind incomplete con punti null.
   I checkpoint storici restano conservati e replay dello stesso requestId non
   autorizza nuove chiamate. Un nuovo contratto richiede un workflow esplicito.
4. `saveCorrection` non riscrive il mirror del riepilogo né il relativo timestamp
   quando i totali sono invariati: feedback-only e acknowledgment legacy-only
   non violano più le Rules. Nessun ampliamento delle Rules; nessun evento
   `scoreAdjusted` vuoto per un cambiamento del solo marker.
5. Card docente e studente: data didattica `verificationDate`, più recente prima
   (assunzione comunicata dall'orchestratore); a pari data titolo alfabetico
   italiano senza differenze di maiuscole/accenti; date assenti/malformate in
   fondo, ID come ultimo tie-break. Nessun fallback a createdAt/activatedAt.

## Evidenze

- Gate locali PASS: format:check, lint, typecheck, 6223 unit test
  (55 contratto + 2201 Functions + 3967 web), build, diff --check.
  CI completa e review indipendente restano gate del merge.
- Test mirati: audit changed/unchanged, output invalido, failure/retry,
  checkpoint replay, accounting e OFF; clock PC ±120 s, salto wall clock,
  rientro, sync fallita/retry e riapertura con deadline scaduta; card UI entrambe.
- Test real service contro emulator in
  `m4-correction-save.integration.rules.test.ts`: feedback-only a punteggio
  invariato, dopo riapertura, acknowledgment-only e complete con legacy
  recommendation non confermata, conservando punti e feedback.
- L'ambiente locale usa Node 24.15.0, pnpm 9.15.9 e Java 8: Rules emulator
  richiede Java 21 e viene verificato dalla CI Node 22/Java 21. Nessuna installazione
  di runtime effettuata. Gate locali e CI sono riportati nella PR.
- Smoke reale separato dell'orchestratore: 12/10/2026, solo sei risposte
  sintetiche HTTP/API, nessun dato scolastico o run Firestore. Economy
  (`gpt-6-luna`) e Quality (`gpt-6.1-sol`): quattro chiamate totali, zero retry,
  entrambi punteggi primary/final `[4,0,3,2,0,4]`. Accounting delle quattro chiamate
  USD 0.033873 (Economy 0.001586; Quality 0.032287). Una quinta chiamata Quality
  con prima proposta artificiale errata corregge POST 4→0 e DELETE 0→4. Il costo
  di questa chiamata aggiuntiva non è incluso nel totale precedente; usage della
  proposta artificiale non rappresenta una nuova spesa e non va contato due volte.
  Prova limitata, non qualificazione universale della correzione scolastica.

## Rollout e rollback

Dopo review e CI verde, orchestratore: deploy DEV mirato e smoke pubblico,
poi PROD autorizzato nel task corrente con il runbook. I flussi autenticati sono
coperti da test UI e Rules emulator CI; la sessione browser disponibile è al
login e non consente di dichiarare uno smoke autenticato cloud. Dopo deploy
verificare pagina pubblica, bundle e rifiuto 401 anonimo delle callable. Target nuovi/modificati:
`functions:examServerTime`, `functions:aiCorrectionPreview`,
`functions:aiCorrectionRun`, hosting. Non occorre deploy Rules. Verificare clock
PC ±120 s, sessione riaperta e deadline originale, feedback-only e nuove
correzioni ON/OFF nei test. Dopo F5 l’utente potrà completare le quattro
correzioni legacy nell’applicazione, mantenendo i punteggi: nessun completamento
automatico né scrittura applicativa cloud sono inclusi nel rollout. Rollback applicativo al commit base, senza
cancellazione di dati/manuali/checkpoint; kill switch IA resta disponibile.
