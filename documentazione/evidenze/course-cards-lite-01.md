# COURSE-CARDS-LITE-01 — libreria corsi compatta

Baseline: `8b247a5566d994f6dbadf3a40ce3f2125f72d72b`. Issue: #453.

## Contratto implementato

- Libreria docente: titolo, anno, classi oppure «Nessuna classe assegnata»,
  «Apri corso» e menu esistente. Nessun contatore, percentuale o contenitore
  metriche vuoto. Variante `course-compact` esplicita: altre card invariate.
- Budget loader: una query programmi + una query classi + un documento metadata
  per corso con import attivo. Zero query UDA/lezioni, zero letture Storage,
  zero nuovi listener, riepiloghi persistiti o scritture.
- Il workspace continua a caricare solo il proprio albero: UDA + lezioni,
  filtrando le lezioni di UDA non ancora committate. Riepilogo e informazioni
  derivano tutti i contatori da questo albero e dai suoi aggiornamenti locali.
- Caricamento: statistiche esplicitamente in attesa, senza numeri o avanzamento.
  Errore: statistiche non disponibili; nessun falso zero. Gli zeri sono validi
  soltanto dopo aver determinato che il corso è vuoto/senza import.
- Notifiche delle mutazioni preservate con `CourseStatistics` separato dai
  metadati `CourseCard`; la libreria ignora patch contenenti soltanto contatori.
  Le azioni import, modifica, eliminazione, riordino e completamento restano
  quelle esistenti; nessuna modifica backend, schema, Rules, IA o dipendenze.

## Verifica locale dell'implementatore

- Typecheck e lint web: PASS. Formattazione dei file modificati e
  `git diff --check`: PASS.
- Suite mirate loader, DidatticaView, CourseWorkspace, workspaceDialogs,
  CourseRecordCard e VerificationRecordCard: PASS (155 test nel run finale).
- Nuovi test coprono budget multi-corso, assenza metriche, focus/menu,
  statistiche in attesa/errore/vuoto, informazioni e albero committato.
- Review indipendente, gate completi/CI e smoke DEV rimangono responsabilità
  dell'orchestratore. Questo documento non attesta deploy o smoke docente reale.

## Smoke browser dell'orchestratore

- Componenti reali `CourseRecordCard` e `RecordActionsMenu`, CSS applicativo,
  fixture sintetica locale: PASS a 1280, 390 e 320 px.
- Nessuna metrica o contenitore `dl`; CTA visibile, titoli lunghi e classi
  multiple senza overflow orizzontale. Trigger menu almeno 44 × 44 px.
- Rinomina simulata senza apertura accidentale, Escape con ritorno del focus,
  apertura da tastiera con Enter: PASS. Nessun errore JavaScript.
- Questa prova non usa account o dati cloud e non sostituisce lo smoke umano
  autenticato in DEV. CI, review e rilascio saranno registrati nella issue #453.

## Rilascio autorizzato e rollback

- Soltanto Hosting DEV; nessun deploy PROD, Functions, Rules o migrazione.
- Versione DEV precedente verificata il 4 settembre 2026:
  `debc9f4784262b9a`, release `1788256572480000` del 1 settembre 2026.
- Rollback: ripristinare questa versione dalla cronologia Hosting di
  `schoolforge-dev`. Nessuna trasformazione dati fa parte del task.

## Limiti

Il costo residuo di una lettura metadata per import serve al filtro anno. Non
sono introdotti contatori denormalizzati né tentativi di modificare le letture
di contenuto necessarie quando il docente apre o modifica un corso.
