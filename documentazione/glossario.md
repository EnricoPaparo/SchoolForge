# SchoolForge — Glossario

**Versione:** 2.0
**Data:** 24 giugno 2026
**Stato:** baseline
**Destinatari:** committente, team di implementazione, operatori

Questo glossario definisce in modo univoco i termini usati in tutti i documenti del progetto SchoolForge. In caso di ambiguità tra un termine di questo glossario e un'interpretazione corrente del linguaggio didattico o tecnico, prevale la definizione qui riportata.

---

## Termini didattici

### Programma
Materia o percorso didattico gestito dal Docente. Equivale concettualmente al programma annuale di una disciplina scolastica (es. "TPSIT — Terzo Anno"). Contiene una o più UDA. In SchoolForge un Programma è un'entità identificata da un `id` stabile; il titolo può cambiare senza invalidare riferimenti storici.

### UDA — Unità di Apprendimento
Unità organizzativa principale all'interno di un Programma. È rappresentata da un file `UDA.md` con front matter YAML (`titolo`, `competenze`, `obiettivi`, `periodo`, `ore`). Raggruppa un insieme di Lezioni tematicamente correlate. Nel contesto scolastico italiano corrisponde all'Unità Didattica di Apprendimento. Ogni UDA appartiene a un solo Programma. Il flag `svolto: true` include l'UDA nell'export del programma svolto.

### Lezione
Unità di conoscenza didattica strutturata come coppia di file Markdown: `lezione-XXX-titolo.md` (contenuto didattico, immagini, obiettivi, domande di autoverifica) e `lezione-XXX-titolo.pool.md` (pool di domande di verifica). In SchoolForge esiste solo la versione corrente di una Lezione; non esistono revisioni storiche. Una Lezione appartiene a una sola UDA nella V1.

### Pool di domande
File `lezione-XXX-titolo.pool.md` associato a una Lezione. Contiene esclusivamente domande di tipo `assessment` con campi obbligatori `id`, `tipo`, `difficoltà`, `peso`, `testo`, `soluzione`. Le domande del pool non appaiono nel rendering della Lezione; alimentano il `questionIndex` e sono selezionabili per le Verifiche.

### Domanda archiviata
Domanda strutturata presente in un file pool.md valido, idonea a essere selezionata per una Verifica. Ha sempre `tipo`, `difficoltà`, `peso` e `soluzione` definiti. Si distingue dalla Domanda generata, prodotta da AI.

### Domanda generata
Proposta prodotta dall'AI a partire dal corpus didattico autorizzato. Diventa utilizzabile solo dopo approvazione esplicita del Docente. Non può essere inserita in una Verifica in stato di proposta.

### Domanda di autoverifica
Domanda con `kind: self_check` nel file lesson.md. Viene visualizzata al Docente nel rendering della Lezione come strumento di studio. Non fa parte del pool delle domande di Verifica.

### Corpus didattico
Insieme delle Lezioni selezionate come fonte per una specifica Verifica o per una specifica invocazione AI. Il corpus è sempre esplicito e delimitato dal Docente; non include lezioni non selezionate, fonti web o basi documentali esterne.

### Verifica (o Prova)
Configurazione immutabile composta da domande selezionate dal pool, con relative soluzioni e punteggi massimi. Alla attivazione il suo contenuto viene congelato come snapshot in Firestore. Il PDF è generato su richiesta dal backend e mai conservato; ogni download studente è protetto dall'email bruciata. SchoolForge non gestisce varianti della stessa Verifica e non conserva rubriche di correzione.

### Soluzione
Risposta corretta associata a una domanda. Per domande chiuse (`closed_single`, `closed_multiple`) è l'insieme degli identificativi delle opzioni corrette; per domande aperte (`open`) è una risposta modello testuale. La soluzione fa parte dello snapshot immutabile della Verifica attivata e non viene mai esposta nel rendering di fruizione della Lezione.

### Coefficienti di punteggio
Due attributi indipendenti di ogni domanda del pool: `difficoltà` (bassa/media/alta) e `peso` (basso/medio/alto). Ciascuno corrisponde a un coefficiente numerico: 0.75 per basso/bassa, 1.00 per medio/media, 1.50 per alto/alta. Il `punteggio_max` di un item è `coeff_difficoltà × coeff_peso`. La `percentuale` è `(Σ punti assegnati / Σ punteggi_max) × 100`.

### Consegna
Insieme delle risposte fornite da uno Studente per una specifica Verifica, attraverso il Portale Verifiche (canale digitale) o inserita manualmente dal Docente (canale cartaceo). Una Consegna acquisita è immutabile nel dato sorgente; eventuali rettifiche successive sono tracciate come modifiche auditabili.

### Correzione
Insieme dei punteggi e commenti associati a una Consegna. Distingue tre origini: punteggio assegnato manualmente dal Docente, punteggio proposto da AI (solo Modulo 5) e punteggio definitivo approvato. La percentuale è calcolata solo quando tutti gli item hanno un punteggio definitivo.

### Email bruciata
Meccanismo che garantisce che ogni indirizzo email studente possa scaricare il PDF di una specifica Verifica una sola volta. Il download è protetto da una transazione Firestore atomica che crea un record nella collezione `burned/{examId}/emails`. Un secondo tentativo con la stessa email è rifiutato con errore 409. Il Docente non è soggetto a questo meccanismo.

### Portale Verifiche
Applicazione web separata (URL distinto) destinata agli Studenti. Consente di accedere a una Verifica tramite link, autenticarsi con account Google scolastico, scaricare il PDF della prova (email bruciata) e inviare risposte digitali. Non condivide autenticazione, route o stato globale con la web app del Docente.

### Programma svolto
File di testo (`.txt`) generato su richiesta del Docente che elenca le UDA e/o Lezioni flaggate come svolte per un dato Programma. Serve per il deposito scolastico dei contenuti effettivamente trattati. Non è un PDF e non viene conservato dopo il download.

### Studente
Persona che svolge una Verifica tramite il Portale Verifiche. In SchoolForge lo Studente non possiede un account applicativo proprio. Il record di uno Studente viene creato automaticamente al primo accesso al portale con una email Google scolastica (creazione lazy): in quel momento il record contiene solo l'email. Nome, cognome e classe sono facoltativi e possono essere completati in seguito dal Docente. L'identità dello Studente è sempre l'email raccolta; il record non dipende dalla pre-registrazione.

### Classe
Raggruppamento opzionale di Studenti creato manualmente dal Docente. La Classe è opzionale nella V1: le Consegne possono essere registrate e corrette anche senza che uno Studente appartenga a una Classe.

### Percentuale
Rapporto percentuale tra punteggio ottenuto e punteggio massimo della Verifica, calcolato come `(punteggio ottenuto / punteggio massimo) × 100`. SchoolForge non converte la percentuale in voto; la scala di voto è una decisione pedagogica del Docente. La percentuale è contrassegnata come `non_definitiva` finché mancano punteggi definitivi per uno o più item.

---

## Termini di sistema

### Docente proprietario
Unico utente applicativo della V1. Accede tramite account Google Workspace for Education assegnato dall'istituto. Ha accesso completo a tutte le funzioni di SchoolForge. Non esistono altri ruoli applicativi nella V1.

### Soggetto Google stabile
Identificatore univoco e permanente assegnato da Google a ogni account (`sub` nel token OpenID Connect). Non dipende dall'indirizzo email, che può cambiare. SchoolForge usa il soggetto Google come chiave di identità primaria del Docente, non l'email.

### Contratto Lesson Markdown v1
Specifica formale del formato dei file Markdown accettati da SchoolForge. Include: front matter YAML obbligatorio, struttura delle sezioni, formato dei file UDA.md, lesson.md e pool.md e regole di validazione. Un file che rispetta il contratto è leggibile come normale Markdown anche senza SchoolForge.

### `schoolforge-question`
Blocco di codice recintato con linguaggio `schoolforge-question` che contiene una singola domanda in formato YAML. Estensione SchoolForge al Markdown standard. Presente solo nei file `.pool.md`. Il tipo `self_check` è ammesso nel file lesson.md.

### Stato di validazione
Attributo di una Lezione che indica se il coppia lesson.md/pool.md rispetta il contratto v1. I valori sono `valid` e `invalid`. Solo le Lezioni `valid` possono contribuire al `questionIndex` e essere selezionate per nuove Verifiche. Una Lezione `invalid` rimane consultabile ma non generativa.

### `questionIndex`
Indice Firestore delle domande `assessment` estratte da tutti i file pool.md correnti validi. Viene aggiornato a ogni importazione, sostituzione o eliminazione di una Lezione. Non è la fonte canonica delle domande (quella è il file pool.md): serve per la composizione rapida delle Verifiche senza dover rileggere tutti i file.

### Snapshot immutabile
Copia del contenuto di una Verifica (domande, soluzioni, punteggi massimi) scritta in Firestore nella subcollection `exams/{examId}/items` al momento dell'attivazione. Lo snapshot è autonomo dalla Lezione di origine: modificare o eliminare una Lezione non altera snapshot già creati. Non esiste snapshot su Cloud Storage né PDF conservato.

### Staging
Area temporanea in Cloud Storage dove vengono caricati i file Markdown e gli asset prima della validazione e della conferma dell'importazione. I file in staging non sono visibili come contenuto didattico. Vengono rimossi dopo importazione completata, annullamento o scadenza.

### Import atomico visibile
Proprietà del processo di importazione che garantisce che una Lezione divenga visibile nel repository solo dopo che tutti i suoi file (lesson.md, pool.md e asset) sono stati validati, confermati e promossi correttamente. Un import parzialmente completato non produce uno stato intermedio visibile.

### AiGateway
Componente backend che media ogni chiamata a un provider AI. Riceve un pacchetto di contesto chiuso costruito dal backend (domanda, soluzione, risposta studente), esegue la chiamata, registra provenienza e risposta e restituisce un output tipizzato. Non espone browsing, tool esterni o retrieval. Il provider concreto è configurabile senza modificare il gateway.

### Feature flag
Controllo server-side che abilita o disabilita una funzionalità per ambiente o per configurazione. In SchoolForge i flag più importanti governano: AI (disabilitata per default) e modalità di correzione automatica.

### Audit event
Evento scritto in modo append-only nel log di audit da operazioni rilevanti. Contiene: attore, azione, identificativo dell'oggetto, timestamp, esito, motivazione opzionale e dati minimi necessari a ricostruire l'operazione. Non contiene testo completo di risposte, punteggi o segreti.

### Gate (G0–G6)
Punto di controllo formale nel piano di implementazione che deve essere superato prima di procedere al modulo successivo. Ogni gate richiede una prova obbligatoria e produce un verbale nel repository. I gate tecnici sono verificati da CI/test automatici; i gate funzionali richiedono verifica del Docente.

---

## Termini tecnici

### Monorepo
Repository Git singolo che contiene tutti i package del progetto: applicazione web docente (`apps/web`), portale studenti (`apps/portale`), Cloud Functions (`functions`), package condivisi (`packages/*`) e file di configurazione Firebase. Gestito con pnpm workspaces.

### pnpm workspaces
Sistema di gestione dei package di un monorepo basato su pnpm. Consente di condividere dipendenze tra package, eseguire script su tutti i workspace e gestire versioni in modo coerente.

### `lesson-contract`
Package TypeScript condiviso tra web app, portale e backend che contiene parser, validatore, tipi e fixture per il contratto Lesson Markdown v1. È l'autorità unica sulla struttura dei file UDA.md, lesson.md e pool.md: né il browser né il backend interpretano il contratto indipendentemente.

Il pacchetto esporta:
- `parseUda(source: string): UdaParseResult`
- `parseLessonMarkdown(source: string): LessonParseResult`
- `parsePoolMarkdown(source: string): PoolParseResult`
- Tipi TypeScript (`Uda`, `Lesson`, `PoolQuestion`, `ParseError`, ...)
- Fixture di test per i casi validi e invalidi del contratto

### Firebase Emulator Suite
Insieme di emulatori locali forniti da Google per sviluppare e testare SchoolForge senza usare risorse cloud reali. Include emulatori per Firestore, Cloud Storage, Firebase Authentication e Cloud Functions.

### Cloud Firestore
Database documentale gestito da Google Cloud usato da SchoolForge per metadati, indici, stati operativi, snapshot delle Verifiche, Consegne, Correzioni, email bruciate e log di audit.

### Cloud Storage
Archiviazione a oggetti gestita da Google Cloud usata da SchoolForge per i file Markdown originali (lesson.md, pool.md, UDA.md), gli asset delle Lezioni, i file di staging temporanei e gli export ZIP del repository. I PDF non vengono mai scritti in Cloud Storage.

### Secret Manager
Servizio Google Cloud per la gestione sicura di segreti (credenziali AI future, token backend). In SchoolForge i segreti non vengono mai scritti in Firestore, in Markdown, in variabili di ambiente non protette o restituiti al browser.

### Firebase Authentication
Servizio di autenticazione Firebase usato da SchoolForge per gestire il login Google del Docente e degli Studenti nel Portale. Rilascia token applicativi verificati dal backend; il soggetto Google stabile viene estratto dal token e confrontato con la configurazione `settings/owner` per il Docente.

### Cloud Functions v2
Ambiente serverless di Google Cloud dove è eseguito il backend di SchoolForge. Le funzioni sono scritte in TypeScript e organizzate come monolite modulare.

### Google Workspace for Education
Suite di prodotti Google destinata agli istituti scolastici. In SchoolForge è il prerequisito obbligatorio per l'autenticazione del Docente e per l'autenticazione degli Studenti nel Portale Verifiche (account email scolastico).

### Mermaid
Strumento per la generazione di diagrammi da testo integrato in Markdown. Usato in SchoolForge per i diagrammi architetturali presenti nei documenti di progetto.

### Vitest
Framework di test unitari e di integrazione TypeScript usato in SchoolForge per testare parser, logica di dominio, regole Firebase e API backend.

### Playwright
Framework per test end-to-end che simula l'interazione del Docente con la web app e dello Studente con il Portale. Usato in SchoolForge per i test E2E dei flussi principali.

### Zod
Libreria TypeScript per la validazione di schemi a runtime. Usata in SchoolForge per validare input degli endpoint Cloud Functions e output dell'AiGateway.

### CommonMark
Standard formale per la specifica del Markdown. Il contratto Lesson Markdown v1 di SchoolForge usa CommonMark come base e aggiunge solo le estensioni minime necessarie (front matter YAML e blocchi `schoolforge-question` nei file pool.md).

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
- **Rubrica di correzione** — Non esiste: i criteri di valutazione sono una scelta del Docente al momento della correzione, non un artefatto strutturato del sistema.
- **Debito formativo / Recupero** — Funzionalità fuori scope V1.
- **Compito / Homework** — Fuori scope.
- **Presenza / Assenza** — Fuori scope; SchoolForge non è un registro elettronico.
- **Classe virtuale / Portale studente con account** — Gli studenti non hanno un account SchoolForge; accedono solo al Portale Verifiche con la propria email Google scolastica.
- **Variante verifica** — Non esiste: ogni Verifica è unica senza varianti per classi o studenti.
- **Revisione lezione** — Non esiste: SchoolForge conserva solo la versione corrente di una Lezione.
- **Google Drive** — Eliminato definitivamente dall'architettura; i PDF non vengono conservati né su Drive né altrove.
- **Google Forms** — Eliminato definitivamente dall'architettura; il Portale Verifiche è l'unico canale digitale di erogazione.
- **PDF persistente** — I PDF sono generati on-demand e scaricati; non vengono mai scritti su storage permanente.
- **Artefatto archiviabile** — Non esiste: SchoolForge non conserva PDF generati né link a storage esterno.
- **Quarantena** — Non esiste nella V2: senza Google Forms non ci sono risposte non mappabili che richiedano quarantena.
