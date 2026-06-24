# SchoolForge — Project Concept Brief

## Scopo del Documento

Questo documento descrive il concept del progetto SchoolForge.

Il documento rappresenta la fonte di verità iniziale del progetto e deve essere utilizzato come input per una successiva Analisi dei Requisiti.

L'obiettivo di questo documento non è descrivere la soluzione tecnica.

L'obiettivo è descrivere:

* il problema da risolvere;
* la visione del prodotto;
* il perimetro del progetto;
* le decisioni già prese;
* i vincoli progettuali;
* la roadmap prevista.

Le decisioni esplicitamente dichiarate in questo documento devono essere considerate deliberate.

L'analisi successiva può proporre miglioramenti tecnici ma non deve alterare gli obiettivi fondamentali del progetto.

---

# Problema

Un docente gestisce normalmente:

* programmi annuali e programmi svolti da depositare presso l'istituto;
* UDA;
* lezioni;
* verifiche;
* recuperi;
* debiti;
* correzioni;
* archiviazione delle prove.

Oggi queste attività sono normalmente distribuite tra strumenti differenti:

* documenti Word;
* PDF;
* Google Drive;
* Google Forms;
* registro elettronico;
* archivi personali.

Questo comporta:

* duplicazione del lavoro;
* scarsa riusabilità dei contenuti;
* difficoltà di manutenzione;
* difficoltà di tracciabilità;
* perdita di conoscenza nel tempo.

Il problema principale non è la generazione delle verifiche.

Il problema principale è l'assenza di una base di conoscenza didattica centralizzata da cui possano derivare tutte le altre attività.

---

# Visione

SchoolForge è un repository didattico Markdown-first.

La conoscenza didattica è l'asset principale del sistema.

Le lezioni rappresentano la fonte unica della conoscenza.

Da tale conoscenza devono derivare:

* presentazione delle lezioni;
* verifiche generate on-demand;
* soluzioni;
* correzioni;
* future analisi didattiche.

Il sistema non deve essere progettato come LMS.

Il sistema non deve essere progettato come registro elettronico.

Il sistema deve essere progettato come repository della conoscenza didattica del docente.

---

# Principi Fondamentali

## Markdown First

La conoscenza deve esistere come file Markdown indipendenti dal sistema.

Il sistema non deve essere il proprietario della conoscenza.

Il sistema deve essere un consumatore della conoscenza.

La perdita del sistema non deve comportare la perdita dei contenuti.

In V1 il docente produce i file Markdown esternamente (con strumenti AI come Claude o GPT, o manualmente). SchoolForge importa e valida il contenuto. Un editor integrato è pianificato per V2.

---

## Knowledge First

La conoscenza è l'asset principale.

Le funzionalità del sistema sono derivate dalla conoscenza.

La progettazione deve sempre privilegiare la conservazione e l'organizzazione della conoscenza rispetto alle funzionalità accessorie.

---

## AI Optional

L'intelligenza artificiale non è un prerequisito del sistema.

Il sistema deve essere utilizzabile anche senza AI.

L'AI rappresenta una capacità aggiuntiva e non una dipendenza architetturale.

---

## Evoluzione Incrementale

Ogni modulo deve essere utilizzabile indipendentemente.

Ogni rilascio deve produrre valore autonomo.

---

## Minimalista ma Eccellente

Il sistema deve essere il più semplice possibile nella sua architettura.

Ogni componente aggiuntivo deve giustificare la propria esistenza.

La qualità dell'esperienza utente non è negoziabile: design moderno, responsivo e graficamente curato.

Il costo operativo deve restare il più basso possibile: nessun servizio sempre acceso, nessun componente enterprise o integrazione a pagamento senza una necessità concreta. L'uso di Firebase Blaze è richiesto, ma il progetto deve usare prima le quote incluse e pagare solo il consumo strettamente necessario.

---

# Utenti

## Versione Iniziale

Un solo docente.

La V1 non prevede:

* multi-docente;
* multi-istituto;
* gestione organizzazioni.

---

## Studenti

Gli studenti non hanno un account SchoolForge.

Gli studenti accedono esclusivamente alla sezione Portale dell'applicazione tramite il link aperto di una verifica.

Gli studenti non si registrano al sistema. Al momento dell'accesso lo studente dichiara nome e cognome: sono dati auto-dichiarati, non verificati, né una credenziale né una prova dell'identità. Il sistema registra nome dichiarato, indirizzo IP, timestamp e user-agent come audit trail consultabile dal docente nel Report Accessi.

---

# Prerequisiti di Deployment

## Accesso del Docente

Il Docente deve poter accedere all'applicazione mediante un'identità autenticata.

SchoolForge usa Firebase Authentication ma non richiede Google Workspace for Education. Il metodo di autenticazione del Docente è configurabile nell'ambiente Firebase, purché garantisca l'accesso esclusivo al Docente proprietario nella V1.

Gli studenti non devono disporre di account Google, account SchoolForge o preregistrazione.

## Firebase e dati applicativi

SchoolForge usa un progetto Firebase di proprietà del Docente come ambiente applicativo. I dati applicativi persistenti devono essere creati nella regione di Milano `europe-west8`, ove il singolo servizio Firebase/Google Cloud lo supporti.

Firebase Hosting può usare una rete di distribuzione globale e Firebase Authentication è un servizio gestito con proprie caratteristiche di localizzazione. SchoolForge non dichiara quindi che ogni elaborazione tecnica avvenga esclusivamente in Italia; la decisione di regione riguarda database, file applicativi e runtime backend.

## Connessione internet

SchoolForge è un'applicazione web con backend serverless. Non esiste una modalità offline.

---

# Contratto di Uscita

SchoolForge garantisce che la conoscenza didattica del Docente rimanga di sua proprietà e sia recuperabile indipendentemente dalla disponibilità della piattaforma.

## Cosa il Docente può sempre recuperare

* **File Markdown originali e asset**: esportabili in qualsiasi momento tramite la funzione "Export repository". Il file ZIP contiene i file nella struttura originale, leggibili con qualsiasi editor di testo, senza dipendenza da SchoolForge.
* **Dati operativi** (configurazioni verifiche, log accessi, consegne digitali, correzioni): esportabili tramite la funzione di export del sistema in formati standard e leggibili indipendentemente dalla piattaforma.

## Cosa non viene recuperato automaticamente

* Il rendering web delle lezioni (dipende dall'applicazione; il Markdown è autonomo).
* I PDF delle verifiche: non vengono mai conservati dal sistema; il docente ne è responsabile una volta scaricati.

---

# Modello Concettuale

```
Programma
    ↓
  UDA  ←── UDA.md (titolo, competenze, obiettivi...)
    ↓
 Lezione ←── lezione.md (contenuto didattico)
             lezione.pool.md (pool domande)
    ↓
Conoscenza Didattica
    ↓
Verifiche on-demand / Correzioni / Analisi future
```

---

# Programmi

Un programma rappresenta una materia o un percorso didattico.

Esempi:

* TPSIT Terzo Anno
* TPSIT Quarto Anno
* Sistemi e Reti Terzo Anno

Un programma contiene una o più UDA.

## Programma Svolto

Il docente può selezionare le UDA e le lezioni effettivamente svolte nel corso dell'anno e scaricare il programma svolto in due formati:

* **Markdown** — file portabile, leggibile con qualsiasi editor, consegnabile digitalmente.
* **PDF** — generato on-demand nel browser, pronto per la stampa e il deposito presso l'istituto.

Struttura del contenuto generato:

```
Programma: TPSIT — Terzo Anno
Anno scolastico: 2025/2026

UDA 1 — Reti e Protocolli
  • Lezione 1 — Introduzione a TCP/IP
  • Lezione 2 — HTTP e HTTPS

UDA 2 — Sicurezza Informatica
  • Lezione 1 — Crittografia simmetrica
```

---

# UDA

Le UDA rappresentano l'unità organizzativa principale all'interno di un Programma.

Ogni UDA è rappresentata da un file `uda-XX-titolo.md` con front matter YAML contenente almeno: titolo, competenze, obiettivi.

Le lezioni appartengono all'UDA per posizione nella cartella. Non è necessaria una lista manuale.

Le verifiche possono essere generate da una singola lezione, da più lezioni o da una o più UDA complete.

---

# Lezioni

Le lezioni sono composte da due file Markdown:

* `lezione-XXX-titolo.md` — contenuto didattico puro: testo, immagini, obiettivi, domande di autoverifica.
* `lezione-XXX-titolo.pool.md` — pool delle domande di verifica associate a quella lezione, non esposte nella fruizione della lezione.

Le lezioni vengono create e modificate esternamente al sistema.

In V1 il docente produce i file Markdown esternamente (con strumenti AI come Claude o GPT, o manualmente). SchoolForge importa e valida il contenuto. Un editor integrato è pianificato per V2.

Il sistema deve permettere:

* upload file singoli;
* upload cartelle;
* sostituzione file;
* eliminazione file.

Il file pool è opzionale. Se non esiste, la lezione è valida e consultabile ma non contribuisce alla generazione delle verifiche.

---

# Pool di Domande

Il file `.pool.md` contiene le domande di verifica associate a una lezione.

Ogni domanda deve specificare:

| Attributo | Valori possibili |
|---|---|
| `tipo` | `aperta` / `chiusa_singola` / `chiusa_multipla` |
| `difficoltà` | `1` / `2` / `3` |
| `peso` | `1` / `2` / `3` |
| `testo` | testo della domanda |
| `soluzione` | risposta (aperte) o opzioni corrette (chiuse) |

**Difficoltà** (scala `1`, `2`, `3`) determina quali domande vengono selezionate in fase di generazione (filtro e minimo garantito per livello).

**Peso** (scala `1`, `2`, `3`) determina quanto conta la domanda nel punteggio finale (importanza didattica, lunghezza, centralità dell'argomento). Il peso non è un secondo attributo di difficoltà: una domanda con `difficoltà` 1 può avere `peso` 3, e viceversa.

**Punteggio massimo per domanda** = `difficoltà × peso` (scala lineare, intervallo 1–9).

La percentuale finale è calcolata come `Σ(punti assegnati) / Σ(punti massimi) × 100`.

---

# Presentazione delle Lezioni

Il sistema deve poter visualizzare le lezioni tramite rendering Markdown.

Requisiti:

* design moderno;
* tema chiaro;
* tema scuro;
* supporto immagini;
* visualizzazione domande autoverifica;
* esclusione delle domande del file pool dal rendering di fruizione.

Non è richiesta una modalità slide.

---

# Classi

Il docente configura la lista delle proprie classi nelle impostazioni dell'applicazione.

La lista è riutilizzata in due contesti:

* **Configurazione verifica** — il docente può associare una verifica a una o più classi della lista.
* **Portale Verifiche** — lo studente seleziona la propria classe da un menu a tendina; la classe non è richiesta ed è selezionabile tra le opzioni configurate dal docente.

---

# Generazione Verifiche

Una verifica è un insieme di impostazioni di configurazione, non un documento pre-generato.

Il docente crea una verifica definendo:

* titolo;
* sorgente: una o più UDA e/o lezioni singole;
* numero totale di domande;
* tipo di domande da includere (aperte, chiuse o entrambe);
* difficoltà da includere, con numero minimo garantito per ciascun livello selezionato;
* varianti: tutte uguali (seed fisso, tutti gli studenti ricevono le stesse domande) o tutte diverse (seed per tentativo, ogni studente riceve un set diverso);
* classi associate (opzionale, dalla lista configurata).

La configurazione della verifica è sempre modificabile dal docente, anche dopo l'attivazione. L'unico elemento immutabile è lo snapshot di un tentativo digitale: dal momento dell'avvio, la copia delle domande mostrate allo studente non cambia. La configurazione della verifica è sempre modificabile; lo snapshot di un tentativo è immutabile dal momento dell'avvio.

Il PDF viene generato on-demand nel browser al momento della richiesta e non viene mai conservato dal sistema.

## Configurazione: validazione

Se la somma dei minimi di difficoltà supera il numero totale di domande configurato, il sistema blocca la configurazione con un messaggio esplicito prima dell'attivazione.

---

# Pool e Selezione Domande

Al momento della generazione, il sistema:

1. raccoglie tutte le domande disponibili dalle lezioni/UDA selezionate;
2. rispetta i minimi per livello di difficoltà;
3. completa il numero richiesto pescando casualmente tra le difficoltà ammesse;
4. calcola il punteggio massimo per ogni domanda estratta.

---

# PDF della Verifica

Il PDF è generato nel browser tramite `@react-pdf/renderer` e scaricato direttamente senza persistenza sul server.

Il PDF generato riporta in intestazione:

| Campo | Studente | Docente |
|---|---|---|
| Titolo verifica | precompilato | precompilato |
| Nome | precompilato | vuoto, compilabile a mano |
| Cognome | precompilato | vuoto, compilabile a mano |
| Classe | precompilata se selezionata | vuoto, compilabile a mano |
| Data | precompilata (data del giorno) | non presente |
| Punti / Max Punti | vuoto per tutti | vuoto per tutti |

Seguono le domande con punteggio massimo indicato per ciascuna e spazio per la risposta.

## Download docente

Il docente può scaricare la verifica in qualsiasi momento, senza inserire dati e senza limitazioni. Il PDF generato ha i campi intestazione vuoti e compilabili a mano, utile per stampa, fotocopie ed erogazione cartacea tradizionale. Il download del docente non registra alcun accesso e non modifica lo stato della verifica.

---

# Distribuzione e Canali di Erogazione

Ogni verifica è accessibile tramite un link generato dal sistema. La verifica non ha una lista di destinatari preassegnati: è semplicemente **aperta** o **chiusa** dal docente. Chiunque disponga del link può accedere finché la verifica è aperta. Il docente gestisce fisicamente la distribuzione del link (e degli eventuali token) in classe.

Il docente distribuisce il link tramite i canali che preferisce (bacheca scolastica, chat di classe).

Se uno studente arriva tardi, il docente può avviare un nuovo tentativo digitale generando un token aggiuntivo, oppure consegnare una copia cartacea; non è prevista la riapertura di un tentativo già inviato.

Lo studente apre il link e sceglie il canale:

## Canale A — Cartaceo

Il canale cartaceo è puramente fisico. Il docente (o lo studente dal link aperto) clicca "Stampa/Scarica PDF": il PDF viene generato direttamente nel browser e scaricato, senza passare per il server. Il canale cartaceo **non** crea alcun record di tentativo (`deliveryAttempt`) e **non** registra alcun accesso. Se utile, un semplice contatore atomico `downloadCount` sul documento della verifica può essere incrementato a ogni download. Non c'è alcun lock: il canale cartaceo non limita i download.

Lo studente svolge la verifica su carta o con qualsiasi strumento esterno. La consegna avviene fisicamente al docente. Il sistema non è coinvolto nella correzione cartacea.

## Canale B — Digitale (Portale Verifiche)

Lo studente inserisce nome, cognome e, facoltativamente, classe. Chiunque abbia il link può avviare un tentativo digitale finché la verifica è aperta; il token è generato on-demand, oppure il docente pre-genera un insieme di N token generici. Il sistema crea il tentativo digitale tramite una Cloud Function che brucia il token mono-uso del tentativo, genera il token di sessione, registra il log di accesso (nome, IP, timestamp, user-agent) e salva lo snapshot delle domande senza esporre soluzioni. Lo studente svolge la verifica direttamente nel portale. Il token mono-uso impedisce una seconda consegna digitale dallo stesso token.

Le risposte vengono salvate strutturate nel database operativo e sono disponibili per la correzione nel sistema.

---

# Portale Verifiche

Il Portale Verifiche è una sezione dell'applicazione accessibile tramite URL pubblico dedicato (`/exam/:token`).

Requisiti:

* design moderno, responsivo, mobile-first;
* schermata di accesso essenziale: dati studente e scelta del canale;
* schermata di svolgimento in fullscreen con tutte le domande in sequenza verticale;
* ogni domanda mostra: tipo, difficoltà, peso, punteggio massimo e campo risposta;
* header sticky con nome studente e bottone "Consegna" sempre visibile;
* deterrenza di base: fullscreen obbligatorio, rilevamento uscita tab con avviso visibile, copia-incolla disabilitato nella UI;
* zero menu, zero navigazione, zero elementi non necessari durante lo svolgimento.

La deterrenza non è sicurezza: un'uscita dal tab non annulla la verifica. Il docente è l'anti-cheat reale.

---

# Correzione

## Correzione Cartacea

La correzione delle prove cartacee avviene interamente fuori dal sistema. SchoolForge non è coinvolto.

## Correzione Digitale

Le consegne digitali del Portale Verifiche sono disponibili nel sistema per la correzione manuale.

Il docente visualizza domanda per domanda con la risposta dello studente e il punteggio massimo. Assegna un punteggio da 0 al massimo e un commento opzionale.

La percentuale finale è calcolata automaticamente: `Σ(punti assegnati) / Σ(punti massimi) × 100`.

SchoolForge non gestisce voti finali. La conversione percentuale in voto è una decisione pedagogica del docente.

Ogni rettifica è tracciata con valore precedente, nuovo valore e motivazione.

## Registro Correzioni

Dalla UI di correzione il docente può aprire un popup **Registro Correzioni**: una tabella di verifica rapida con una riga per consegna corretta, con le colonne **Nome**, **Cognome**, **Punteggio**, **Percentuale** e **Data consegna**. Serve a controllare a colpo d'occhio gli esiti di una verifica.

Dallo stesso popup il docente può, in via opzionale, esportare il registro come **PDF** o **CSV**. L'export è generato on-demand nel browser e non viene conservato dal sistema. Questa vista sostituisce un'esportazione grezza su file da copiare e incollare.

---

# Esportazione delle Verifiche Svolte

Le verifiche svolte nel Portale Verifiche digitale devono poter essere esportate tutte insieme dal Docente tramite il comando **Esporta verifiche**.

L'export è costruito dalle consegne digitali definitive e dai rispettivi snapshot di verifica effettivamente assegnati allo studente. Non dipende dalla versione corrente delle lezioni o dei pool.

Per ogni consegna inclusa, il documento di export deve contenere almeno:

* dati dichiarati dallo studente: nome, cognome e classe se presente; più i dati di accesso (IP, timestamp) a fini di audit;
* dati della verifica: titolo, data e identificativo del tentativo;
* domande effettivamente assegnate, con tipo, difficoltà, peso e punteggio massimo;
* risposta fornita per ogni domanda;
* punteggio, commento e percentuale, se la correzione è disponibile.

Le consegne sono ordinate per verifica e poi per data di consegna. Le consegne annullate o eliminate non fanno parte dell'export.

L'export è generato on-demand nel browser del Docente in tre formati:

* **PDF** — documento unico pronto per la stampa e l'archiviazione;
* **Markdown** — portabile e leggibile senza SchoolForge;
* **CSV** — compatibile con Excel, Google Sheets e registro elettronico.

Il Docente sceglie il formato al momento dell'export. I file vengono scaricati senza persistenza sul server.

---

# Correzione Assistita AI

**Fuori scope V1 / pianificato per V2.** La correzione AI è il Modulo 5 ed è interamente rinviata alla V2. La descrizione seguente resta valida come specifica del modulo, ma non fa parte del perimetro V1.

Richiede consegne digitali strutturate (Portale Verifiche).

## Obiettivo

Ridurre il tempo di correzione del docente mantenendo la governance del processo in mano al docente.

## Modalità Assistita

L'AI propone punteggio, motivazione e commento per ogni risposta, con spiegazione degli errori.

Il docente approva, modifica o rifiuta ogni proposta individualmente o in blocco.

## Modalità Automatica

L'AI assegna e approva automaticamente la correzione.

Attivabile solo con opt-in esplicito del docente per la specifica verifica o assegnazione.

Ogni esito automatico è marcato come tale e rimane modificabile.

Il docente può inserire una breve nota testuale di correzione che l'AI deve considerare per la specifica verifica o assegnazione.

## Contesto di Correzione

L'AI utilizza esclusivamente:

* lezione sorgente;
* domanda;
* soluzione;
* risposta dello studente.

Nessuna fonte web. Nessun retrieval esterno.

---

# Roadmap

## Modulo 1

Repository Didattico: Programmi, UDA, lezioni, pool domande, rendering, export repository, programma svolto (PDF + Markdown).

---

## Modulo 2

Generazione Verifiche e PDF: verifica come configurazione, classi configurabili, generazione on-demand nel browser, download docente senza limiti, Portale Verifiche canale cartaceo con download PDF diretto.

---

## Modulo 3

Portale Verifiche digitale: svolgimento online, snapshot tramite Cloud Function, bozze, consegna strutturata su Cloud Firestore.

---

## Modulo 4

Correzione manuale e percentuali: correzione consegne digitali, punteggi, percentuali, rettifiche tracciate, popup Registro Correzioni (con export PDF/CSV) ed export globale in PDF, Markdown e CSV.

---

## Modulo 5 — fuori scope V1 / pianificato per V2

Correzione Assistita AI: proposte assistite, approvazione massiva, modalità automatica opt-in. Spostato interamente alla V2.

---

# Decisione Operativa Formalizzata — C-01

| Voce | Decisione |
|---|---|
| Provider dell'ambiente | Firebase, su progetto di proprietà del Docente. |
| Regione dei dati applicativi | Milano `europe-west8`, ove supportata dal servizio. |
| Backup | Markdown e asset in Cloud Storage sono portabili e protetti dalla ridondanza nativa di Storage (nessun job di backup dedicato). Per Firestore il Docente avvia un export manuale on-demand dalla pagina impostazioni; nessuno scheduler o cron. |
| RPO | Best-effort: affidato all'export manuale Firestore eseguito dal Docente; non è garantito un punto di ripristino entro un intervallo fisso. |
| RTO | Non garantito in V1. |
| Responsabile operativo | Il Docente: proprietario del progetto, delle credenziali, del billing, dell'esecuzione degli export manuali e dell'avvio del ripristino. |

---

# Decisioni Aperte

In V1 non restano decisioni aperte bloccanti. Le decisioni C-02 e C-03 riguardano il Modulo 5 (AI), spostato interamente alla V2; non condizionano il rilascio della V1. C-02 è inoltre risolta in linea di principio (vedi sotto).

| ID | Decisione | Stato | Owner | Scadenza |
|---|---|---|---|---|
| C-02 | Provider AI e modello di default | **Risolta (V2):** OpenAI API (default `gpt-4o-mini`) oppure Anthropic Claude API (default `claude-haiku-4-5-20251001`); il Docente configura la chiave API nelle impostazioni. | Committente / Docente | V2, prima del Modulo 5 |
| C-03 | Regola didattica per la correzione automatica, ambito e eventuale revisione umana obbligatoria | Rinviata alla V2 insieme a M5 | Committente / Docente | V2, prima dell'abilitazione modalità automatica |

Vedi anche `decisioni.md` per il registro completo. Ogni decisione produce un verbale scritto nel repository che documenta: data, approvatore, opzioni valutate, scelta effettuata e vincoli operativi.

---

# Evoluzioni Future

Le seguenti funzionalità non fanno parte della V1.

---

## Multi Docente

Supporto a più docenti.

---

## Editor Integrato

Modifica dei Markdown direttamente dal sistema.

---

## Sommario Curricolare PDF

Generazione automatica di un sommario curricolare (curriculum vitae della classe) in PDF a partire dai programmi svolti. In V1 resta disponibile l'export del programma svolto in Markdown; la generazione PDF di questo sommario curricolare è rinviata alla V2. Il programma svolto in PDF descritto nel Modulo 1 resta invece parte della V1.

---

## Specchietto Consegne

Popup sulla verifica attiva che mostra in tempo reale chi ha consegnato e chi non ha ancora consegnato.

---

## Profilo Studente Assistito da AI

Analisi dello storico delle verifiche digitali.

Produzione di:

* punti di forza;
* punti di debolezza;
* andamento nel tempo;
* suggerimenti di studio;
* sintesi delle competenze.

L'obiettivo non è il semplice storico dei punteggi.

L'obiettivo è costruire una rappresentazione dell'evoluzione didattica dello studente.

---

# Fuori Scope

Non fanno parte del progetto:

* registro elettronico;
* gestione assenze;
* gestione compiti;
* forum;
* chat;
* videolezioni;
* LMS completo;
* social learning;
* PDF conservati dal sistema;
* correzione di prove cartacee nel sistema;
* portale studenti con account e autenticazione propria;
* contenuti provenienti dal web come fonte didattica primaria;
* invio di email agli studenti.

---

# Definizione Finale

SchoolForge è un repository didattico Markdown-first che centralizza la conoscenza del docente e la utilizza come fonte unica per generare verifiche on-demand, raccogliere consegne digitali, supportare la correzione manuale, esportare le verifiche svolte e abilitare future analisi didattiche. La conoscenza rimane indipendente dalla piattaforma. I PDF, gli export e il programma svolto sono generati on-demand nel browser e non vengono conservati dal sistema. L'AI è una capacità opzionale e incrementale. Ogni modulo produce valore autonomo.
