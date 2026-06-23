# SchoolForge — Glossario

**Versione:** 1.0
**Data:** 22 giugno 2026
**Stato:** baseline
**Destinatari:** committente, team di implementazione, operatori

Questo glossario definisce in modo univoco i termini usati in tutti i documenti del progetto SchoolForge. In caso di ambiguità tra un termine di questo glossario e un'interpretazione corrente del linguaggio didattico o tecnico, prevale la definizione qui riportata.

---

## Termini didattici

### Programma
Materia o percorso didattico gestito dal Docente. Equivale concettualmente al programma annuale di una disciplina scolastica (es. "TPSIT — Terzo Anno"). Contiene una o più UDA. In SchoolForge un Programma è un'entità identificata da un `id` stabile; il titolo può cambiare senza invalidare riferimenti storici.

### UDA — Unità di Apprendimento
Unità organizzativa principale all'interno di un Programma. Raggruppa un insieme di Lezioni tematicamente correlate. Nel contesto scolastico italiano corrisponde all'Unità Didattica di Apprendimento come definita nei documenti ministeriali. Ogni UDA appartiene a un solo Programma; più UDA dello stesso Programma possono essere ordinate arbitrariamente dal Docente.

### Lezione
Documento Markdown canonico che rappresenta un'unità di conoscenza didattica. È il mattone fondamentale del repository. Una Lezione include: contenuto didattico, immagini, obiettivi, domande di autoverifica e domande di verifica. In SchoolForge esiste solo la versione corrente di una Lezione; non esistono revisioni storiche. Una Lezione appartiene a una sola UDA nella V1.

### Corpus didattico
Insieme delle Lezioni selezionate come fonte per una specifica Verifica o per una specifica invocazione AI. Il corpus è sempre esplicito e delimitato dal Docente; non include lezioni non selezionate, fonti web o basi documentali esterne.

### Domanda archiviata
Domanda strutturata presente in una Lezione valida e idonea a essere selezionata per una Verifica. Si distingue dalla Domanda generata, che è invece prodotta da AI. Una domanda archiviata ha `kind: assessment` nel contratto Markdown.

### Domanda generata
Proposta prodotta dall'AI a partire dal corpus didattico autorizzato. Diventa utilizzabile solo dopo approvazione esplicita del Docente. Non può essere inserita in una Verifica in stato di proposta.

### Domanda di autoverifica
Domanda con `kind: self_check` nel contratto Markdown. Viene visualizzata al Docente nel rendering della Lezione come strumento di studio. Non fa parte del pool delle domande di Verifica e non viene nascosta nel rendering di fruizione.

### Verifica (o Prova)
Prova unica composta da domande selezionate o generate, con relative soluzioni, rubriche e punteggi massimi. Alla pubblicazione il suo contenuto viene congelato in modo immutabile. Sinonimo di "prova scritta" nel contesto scolastico. SchoolForge non gestisce varianti della stessa Verifica.

### Rubrica di correzione
Schema che specifica i criteri di valutazione di una risposta aperta, i punteggi parziali attribuibili a ciascun criterio e il punteggio massimo ottenibile. In SchoolForge la rubrica è parte integrante della Verifica pubblicata e rimane immutabile insieme alle domande.

### Soluzione
Risposta corretta o chiave di risposta associata a una domanda. Per domande chiuse è l'insieme degli identificativi delle opzioni corrette; per domande aperte è una risposta modello o una spiegazione. La soluzione è parte del contenuto immutabile della Verifica pubblicata e non viene mostrata nel rendering di fruizione della Lezione.

### Consegna
Insieme delle risposte fornite da uno Studente per una specifica Assegnazione e Verifica. Una Consegna acquisita è immutabile nel dato sorgente: eventuali rettifiche successive sono tracciate come modifiche auditabili sopra il dato originale.

### Correzione
Insieme dei punteggi, commenti, motivazioni e approvazioni associati a una Consegna. Distingue tre origini: punteggio proposto da AI, punteggio approvato/modificato dal Docente e punteggio assegnato automaticamente. La percentuale definitiva è calcolata solo quando tutti gli item hanno un punteggio definitivo.

### Assegnazione
Legame formale tra una Verifica pubblicata, un insieme di destinatari (Classe o Studenti specifici) e un canale di erogazione (PDF o Google Forms). Una Verifica può avere più Assegnazioni in momenti diversi.

### Artefatto archiviabile
File PDF o altro documento generato e collegato in modo immutabile a una specifica Verifica o Consegna. In SchoolForge un artefatto è registrato con identificativo della Verifica, hash del file, data di generazione e collegamento al file caricato su Google Drive dal Docente.

### Quarantena
Stato in cui viene posta una Consegna acquisita da Google Forms che non può essere attribuita con certezza a uno Studente o a una Verifica. Una Consegna in quarantena non entra nello storico definitivo finché il Docente non la risolve o la scarta esplicitamente.

### Studente
Persona che svolge una Verifica. In SchoolForge lo Studente non possiede un account e non accede al sistema. Il record di uno Studente viene creato automaticamente al primo import di una risposta Google Forms che contenga un'email non ancora presente nel sistema (creazione lazy): in quel momento il record contiene solo l'email raccolta. Nome, cognome e Classe sono facoltativi e possono essere completati in seguito dal Docente, oppure importati tramite roster Google Education. L'identità dello Studente è sempre l'email raccolta dal Form; il record non dipende dalla pre-registrazione.

### Classe
Raggruppamento di Studenti creato manualmente dal Docente o importato tramite roster Google Education. La Classe è opzionale nella V1: le Consegne possono essere registrate e corrette anche senza che uno Studente appartenga a una Classe. La Classe viene registrata nello storico con il valore presente al momento dell'Assegnazione; eventuali cambi successivi non modificano lo storico pregresso.

### Roster
Elenco di classi e studenti importabile dal servizio Google Workspace for Education tramite API Google Education. In SchoolForge l'importazione del roster è sempre opzionale; la gestione manuale di classi e studenti e la creazione lazy tramite Forms sono i percorsi sempre disponibili.

### Percentuale
Rapporto percentuale tra punteggio ottenuto e punteggio massimo della Verifica, calcolato come `(punteggio ottenuto / punteggio massimo) × 100`. SchoolForge non converte la percentuale in voto; la scala di voto è una decisione pedagogica del Docente. La percentuale è contrassegnata come `non_definitiva` finché mancano punteggi per uno o più item.

### Debito formativo e recupero
Termini del sistema scolastico italiano che descrivono una valutazione insufficiente e la relativa procedura di reintegro. Sono fuori scope della V1 di SchoolForge; non esistono entità, stati o workflow dedicati.

---

## Termini di sistema

### Docente proprietario
Unico utente applicativo della V1. Accede tramite account Google Workspace for Education assegnato dall'istituto. Ha accesso completo a tutte le funzioni di SchoolForge. Non esistono altri ruoli applicativi nella V1.

### Soggetto Google stabile
Identificatore univoco e permanente assegnato da Google a ogni account (`sub` nel token OpenID Connect). Non dipende dall'indirizzo email, che può cambiare. SchoolForge usa il soggetto Google come chiave di identità primaria del Docente, non l'email.

### Contratto Lesson Markdown v1
Specifica formale del formato dei file Markdown accettati da SchoolForge. Include: front matter YAML obbligatorio, struttura delle sezioni, formato dei blocchi `schoolforge-question` e regole di validazione. Un file che rispetta il contratto è leggibile come normale Markdown anche senza SchoolForge.

### `schoolforge-question`
Blocco di codice recintato con linguaggio `schoolforge-question` che contiene una singola domanda in formato YAML. Estensione SchoolForge al Markdown standard. I due tipi principali sono `self_check` (autoverifica, visibile nel rendering) e `assessment` (verifica, nascosto nel rendering di fruizione).

### Stato di validazione
Attributo di una Lezione che indica se il suo Markdown rispetta il contratto v1. I valori sono `valida` e `non_valida`. Solo le Lezioni `valide` possono contribuire al `questionIndex` e essere selezionate per nuove Verifiche. Una Lezione `non_valida` rimane consultabile ma non generativa.

### `questionIndex`
Indice Firestore delle domande `assessment` estratte da tutte le Lezioni correnti valide. Viene aggiornato a ogni importazione, sostituzione o eliminazione di una Lezione. Non è la fonte canonica delle domande (quella è il Markdown): serve per la composizione rapida delle Verifiche senza dover rileggere tutti i file.

### Snapshot immutabile
Copia del contenuto di una Verifica (domande, soluzioni, rubriche, punteggi massimi) scritta in Firestore al momento della pubblicazione. Lo snapshot è autonomo dalla Lezione di origine: modificare o eliminare una Lezione non altera snapshot già creati.

### Staging
Area temporanea in Cloud Storage dove vengono caricati i file Markdown e gli asset prima della validazione e della conferma dell'importazione. I file in staging non sono visibili come contenuto didattico. Vengono rimossi dopo importazione completata, annullamento o scadenza.

### Import atomico visibile
Proprietà del processo di importazione che garantisce che una Lezione divenga visibile nel repository solo dopo che tutti i suoi file (Markdown e asset) sono stati validati, confermati e promossi correttamente. Un import parzialmente completato non produce uno stato intermedio visibile.

### AiGateway
Componente backend che media ogni chiamata a un provider AI. Riceve un pacchetto di contesto chiuso costruito dal backend (corpus selezionato, istruzioni, configurazione), esegue la chiamata, registra provenienza e risposta e restituisce un output tipizzato. Non espone browsing, tool esterni o retrieval. Il provider concreto è configurabile senza modificare il gateway.

### Feature flag
Controllo server-side che abilita o disabilita una funzionalità per ambiente o per configurazione. In SchoolForge i flag più importanti governano: AI (disabilitata di default), Google Forms, roster Google Education e modalità di correzione automatica.

### Audit event
Evento scritto in modo append-only nel log di audit da operazioni rilevanti. Contiene: attore, azione, identificativo dell'oggetto, timestamp, esito, motivazione opzionale e dati minimi necessari a ricostruire l'operazione. Non contiene testo completo di risposte, punteggi o segreti.

### Gate (G0–G6)
Punto di controllo formale nel piano di implementazione che deve essere superato prima di procedere alla fase successiva. Ogni gate richiede una prova obbligatoria e produce un verbale nel repository. I gate tecnici sono verificati da CI/test automatici; i gate funzionali richiedono verifica del Docente.

---

## Termini tecnici

### Monorepo
Repository Git singolo che contiene tutti i package del progetto: applicazione web (`apps/web`), Cloud Functions (`functions`), package condivisi (`packages/*`) e file di configurazione Firebase. Gestito con pnpm workspaces.

### pnpm workspaces
Sistema di gestione dei package di un monorepo basato su pnpm. Consente di condividere dipendenze tra package, eseguire script su tutti i workspace e gestire versioni in modo coerente.

### `lesson-contract`
Package TypeScript condiviso tra web app e backend che contiene parser, validatore, tipi e fixture per il contratto Lesson Markdown v1. È l'autorità unica sulla struttura del Markdown: né il browser né il backend interpretano il contratto indipendentemente.

### Firebase Emulator Suite
Insieme di emulatori locali forniti da Google per sviluppare e testare SchoolForge senza usare risorse cloud reali. Include emulatori per Firestore, Cloud Storage, Firebase Authentication e Cloud Functions.

### Cloud Firestore
Database documentale gestito da Google Cloud usato da SchoolForge per metadati, indici, stati operativi, snapshot delle Verifiche, Consegne, Correzioni e log di audit.

### Cloud Storage
Archiviazione a oggetti gestita da Google Cloud usata da SchoolForge per i file Markdown originali, gli asset delle Lezioni, i file di staging temporanei e gli export ZIP del repository.

### Secret Manager
Servizio Google Cloud per la gestione sicura di segreti (token OAuth, credenziali AI). In SchoolForge i segreti non vengono mai scritti in Firestore, in Markdown, in variabili di ambiente non protette o restituiti al browser.

### Firebase Authentication
Servizio di autenticazione Firebase usato da SchoolForge per gestire il login Google del Docente. Rilascia token applicativi verificati dal backend; il soggetto Google stabile viene estratto dal token e confrontato con la configurazione `settings/owner`.

### Cloud Functions v2
Ambiente serverless di Google Cloud dove è eseguito il backend di SchoolForge. Le funzioni sono scritte in TypeScript e organizzate come monolite modulare.

### Google Workspace for Education
Suite di prodotti Google destinata agli istituti scolastici. In SchoolForge è il prerequisito obbligatorio per l'autenticazione del Docente, la creazione di Google Forms e l'importazione opzionale del roster tramite API Google Education.

### Google Forms
Canale digitale principale per l'erogazione delle Verifiche agli studenti. Usato in modo opzionale. In SchoolForge la creazione e il collegamento di un Form sono funzionalità aggiuntive; il percorso PDF manuale resta sempre disponibile.

### Google Education API (Classroom / Roster)
API Google che consente l'importazione di classi e studenti da Google Workspace for Education. Usata in modo opzionale in SchoolForge; richiede autorizzazione esplicita del Docente e scope minimi.

### Mermaid
Strumento per la generazione di diagrammi da testo integrato in Markdown. Usato in SchoolForge per i diagrammi architetturali presenti nei documenti di progetto.

### Vitest
Framework di test unitari e di integrazione TypeScript usato in SchoolForge per testare parser, logica di dominio, regole Firebase e API backend.

### Playwright
Framework per test end-to-end che simula l'interazione del Docente con la web app. Usato in SchoolForge per i test E2E dei flussi principali.

### Zod
Libreria TypeScript per la validazione di schemi a runtime. Usata in SchoolForge per validare input degli endpoint Cloud Functions e output dell'AiGateway.

### CommonMark
Standard formale per la specifica del Markdown. Il contratto Lesson Markdown v1 di SchoolForge usa CommonMark come base e aggiunge solo le estensioni minime necessarie (front matter YAML e blocchi `schoolforge-question`).

---

## Acronimi e abbreviazioni

| Sigla | Forma estesa |
|---|---|
| UDA | Unità di Apprendimento |
| LMS | Learning Management System |
| RPO | Recovery Point Objective |
| RTO | Recovery Time Objective |
| SLO | Service Level Objective |
| CSP | Content Security Policy |
| CORS | Cross-Origin Resource Sharing |
| YAML | Yet Another Markup Language |
| E2E | End-to-End |
| CI | Continuous Integration |
| CD | Continuous Deployment |
| PR | Pull Request |
| DoR | Definition of Ready |
| DoD | Definition of Done |
| ADR | Architecture Decision Record |
| FR | Requisito Funzionale |
| BR | Regola di Business |
| NFR | Requisito Non Funzionale |
| AC | Criterio di Accettazione |

---

## Appendice A — Termini intenzionalmente fuori glossario

I seguenti termini NON sono usati in SchoolForge nella V1 e non devono comparire in codice, commenti o documentazione tecnica come entità del dominio:

- **Voto** — SchoolForge gestisce percentuali, non voti. La conversione è a carico del Docente.
- **Debito formativo / Recupero** — Funzionalità fuori scope V1.
- **Compito / Homework** — Fuori scope.
- **Presenza / Assenza** — Fuori scope; SchoolForge non è un registro elettronico.
- **Classe virtuale / Portale studente** — Fuori scope; gli studenti non accedono a SchoolForge.
- **Variante verifica** — Non esiste: ogni Verifica è unica senza varianti per classi o studenti.
- **Revisione lezione** — Non esiste: SchoolForge conserva solo la versione corrente di una Lezione.
