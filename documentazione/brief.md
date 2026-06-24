# SchoolForge — Project Concept Brief

**Versione:** 2.0
**Data:** 24 giugno 2026
**Stato:** fonte di verità del concept

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

La qualità dell'esperienza utente non è negoziabile: design moderno, responsivo e graficamente curato in entrambe le applicazioni.

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

Gli studenti accedono esclusivamente al Portale Verifiche per scaricare la propria verifica o svolgerla digitalmente.

Gli studenti non si registrano al sistema. Il loro riconoscimento avviene tramite email scolastica Google inserita al momento dell'accesso alla verifica.

---

# Prerequisiti di Deployment

L'uso di SchoolForge richiede i seguenti prerequisiti non negoziabili. In assenza di uno qualsiasi di questi, il sistema non può essere avviato.

## Google Workspace for Education

Il Docente deve disporre di un account Google Workspace for Education assegnato da un istituto scolastico.

Questo non è un vincolo tecnico aggirabile: è la scelta architetturale centrale del sistema.

Un account Google personale (@gmail.com) non è sufficiente.

Gli studenti devono disporre di un account Google scolastico. Qualora non ne fossero già in possesso, il docente ne coordina la creazione ad inizio anno.

Le funzionalità che dipendono da Google Workspace for Education:

* autenticazione del Docente;
* identificazione degli studenti tramite email scolastica Google.

## Progetto Firebase

È necessario un progetto Firebase con i seguenti servizi abilitati:

* Firebase Authentication;
* Cloud Firestore;
* Cloud Storage;
* Cloud Functions v2;
* Secret Manager.

Il piano gratuito Firebase (Spark) è sufficiente per un singolo docente nella V1.

La decisione su regione, backup, RPO e RTO è documentata come C-01.

## Connessione internet

SchoolForge è un'applicazione web SPA con backend serverless. Non esiste una modalità offline.

---

# Privacy e Tutela dei Minori

Dal Modulo 2 SchoolForge tratta dati personali di minori (nome, cognome, email scolastica, classe, risposte alle verifiche). Questo è un vincolo di prodotto, non un dettaglio implementativo.

Principi:

* **Minimizzazione**: si raccoglie solo ciò che serve a identificare la consegna e a correggerla. Niente dati anagrafici nei log o negli audit; niente dati di studenti negli export del repository.
* **Titolarità scolastica**: in ambito didattico il titolare del trattamento è di norma l'istituto; il docente opera nel suo perimetro. L'assetto va formalizzato prima del primo trattamento reale.
* **Residenza dei dati**: la regione di trattamento (decisione C-01) deve essere coerente con la tutela di dati di minori in ambito UE.
* **Invio all'AI solo con consenso**: nessuna risposta di uno studente è inviata a un provider AI senza consenso esplicito del docente e senza che ne siano mostrati i dati trasmessi.
* **Diritti degli interessati**: accesso, rettifica e cancellazione sono gestiti tramite operazioni backend auditate.

Base giuridica, contenuto dell'informativa, periodo di retention e procedura di cancellazione sono fissati nel verbale [`decisioni/privacy-minori.md`](decisioni/privacy-minori.md), che deve essere `decisa` prima del go-live in produzione del Modulo 2.

---

# Contratto di Uscita

SchoolForge garantisce che la conoscenza didattica del Docente rimanga di sua proprietà e sia recuperabile indipendentemente dalla disponibilità della piattaforma.

## Cosa il Docente può sempre recuperare

* **File Markdown originali e asset**: esportabili in qualsiasi momento tramite la funzione "Export repository". Il file ZIP contiene i file nella struttura originale, leggibili con qualsiasi editor di testo, senza dipendenza da SchoolForge.
* **Dati operativi** (configurazioni verifiche, email bruciate, consegne digitali, correzioni): esportabili tramite export Firestore dal pannello Google Cloud, leggibili come documenti JSON standard.
* **Log di audit**: incluso nell'export Firestore.

## Cosa non viene recuperato automaticamente

* Il rendering web delle lezioni (dipende dall'applicazione; il Markdown è autonomo).
* I PDF delle verifiche: non vengono mai conservati dal sistema; il docente ne è responsabile una volta scaricati.
* Le integrazioni Google (richiedono ri-configurazione OAuth in un nuovo sistema).

## Procedura di uscita

1. Eseguire "Export repository" dalla UI: produce un file ZIP con tutti i Markdown e gli asset correnti.
2. Richiedere un export Firestore dal pannello Google Cloud (dati operativi, verifiche, consegne digitali, storico).
3. Revocare le autorizzazioni OAuth di SchoolForge dal pannello Google del proprio account.
4. Eliminare il progetto Firebase se non più necessario.

Il punto 1 è sempre disponibile dalla UI. I punti 2–4 richiedono accesso alla console Google Cloud.

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

Il docente può selezionare le UDA e le lezioni effettivamente svolte nel corso dell'anno e scaricare un file di testo con la struttura del programma svolto, pronto per essere depositato presso l'istituto scolastico.

Il file è in formato testo semplice, non PDF, universalmente apribile.

Struttura del file generato:

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

Ogni UDA è rappresentata da un file `uda-XX-titolo.md` con front matter YAML contenente almeno: titolo, competenze, obiettivi, periodo, ore previste.

Le lezioni appartengono all'UDA per posizione nella cartella. Non è necessaria una lista manuale.

Le verifiche possono essere generate da una singola lezione, da più lezioni o da una o più UDA complete.

---

# Lezioni

Le lezioni sono composte da due file Markdown:

* `lezione-XXX-titolo.md` — contenuto didattico puro: testo, immagini, obiettivi, domande di autoverifica.
* `lezione-XXX-titolo.pool.md` — pool delle domande di verifica associate a quella lezione.

Le lezioni vengono create e modificate esternamente al sistema.

La V1 non prevede editor integrato.

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
| `difficoltà` | `bassa` / `media` / `alta` |
| `peso` | `basso` / `medio` / `alto` |
| `testo` | testo della domanda |
| `soluzione` | risposta modello (aperte) o opzioni corrette (chiuse) |

**Difficoltà** determina quale domande vengono selezionate in fase di generazione (filtro e minimo garantito per livello).

**Peso** determina quanto conta la domanda nel punteggio finale (importanza didattica, lunghezza, centralità dell'argomento). Il peso non è un secondo attributo di difficoltà: una domanda può essere facile ma avere peso alto, e viceversa.

**Punteggio massimo per domanda** = `coeff_difficoltà × coeff_peso`

| Livello | Coefficiente |
|---|---|
| Basso / Bassa | 0.75 |
| Medio / Media | 1.00 |
| Alto / Alta | 1.50 |

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
* esclusione domande di verifica dal rendering di fruizione.

Non è richiesta una modalità slide.

---

# Generazione Verifiche

Una verifica è un insieme di impostazioni di configurazione, non un documento pre-generato.

Il docente crea una verifica definendo:

* titolo;
* sorgente: una o più UDA e/o lezioni singole;
* numero totale di domande;
* tipo di domande da includere (aperte, chiuse o entrambe);
* difficoltà da includere, con numero minimo garantito per ciascun livello selezionato;
* varianti: tutte uguali (seed fisso, tutti gli studenti ricevono le stesse domande) o tutte diverse (seed per email, ogni studente riceve un set diverso).

Le impostazioni diventano immutabili al momento dell'attivazione della verifica.

Il PDF viene generato on-demand al momento della richiesta dello studente o del docente, e non viene mai conservato dal sistema.

## Configurazione: validazione

Se la somma dei minimi di difficoltà supera il numero totale di domande configurato, il sistema blocca la configurazione con un messaggio esplicito prima dell'attivazione.

---

# Pool e Selezione Domande

Al momento della generazione, il sistema:

1. raccoglie tutte le domande disponibili dalle lezioni/UDA selezionate;
2. rispetta i minimi per livello di difficoltà flaggati;
3. completa il numero richiesto pescando casualmente tra le difficoltà ammesse;
4. calcola il punteggio massimo per ogni domanda estratta.

Le domande generate tramite AI devono basarsi esclusivamente sulle lezioni selezionate. L'utilizzo di conoscenza proveniente dal web è esplicitamente escluso.

---

# PDF della Verifica

Il PDF generato riporta in intestazione:

| Campo | Studente | Docente |
|---|---|---|
| Titolo verifica | precompilato | precompilato |
| Nome | precompilato | vuoto, compilabile a mano |
| Cognome | precompilato | vuoto, compilabile a mano |
| Email | precompilata | vuoto, compilabile a mano |
| Classe | precompilata se inserita, altrimenti vuoto | vuoto, compilabile a mano |
| Data | precompilata (data del giorno) | non presente |
| Punti / Max Punti | vuoto per tutti | vuoto per tutti |

Seguono le domande con punteggio massimo indicato per ciascuna e spazio per la risposta.

## Download docente

Il docente può scaricare la verifica in qualsiasi momento, senza inserire dati e senza limitazioni. Il PDF generato ha i campi intestazione vuoti e compilabili a mano, utile per stampa, fotocopie ed erogazione cartacea tradizionale. Il download del docente non brucia email e non modifica lo stato della verifica.

---

# Distribuzione e Canali di Erogazione

Ogni verifica attiva è accessibile tramite un link univoco generato dal sistema.

Il docente distribuisce il link tramite i canali che preferisce (bacheca scolastica, chat di classe, email).

Lo studente apre il link e sceglie il canale:

## Canale A — Cartaceo

Lo studente inserisce nome, cognome, email scolastica e, facoltativamente, classe. Il sistema genera il PDF con i dati precompilati e lo studente lo scarica. L'email è bruciata per quella verifica: non è possibile scaricare una seconda volta con la stessa email.

Lo studente svolge la verifica su carta o con qualsiasi strumento esterno. La consegna avviene fisicamente al docente. Il sistema non è coinvolto nella correzione cartacea.

## Canale B — Digitale (Portale Verifiche)

Lo studente inserisce nome, cognome, email scolastica e, facoltativamente, classe. Il sistema genera le domande e lo studente le svolge direttamente nel portale. L'email è bruciata per quella verifica.

Le risposte vengono salvate strutturate su Firestore e sono disponibili per la correzione nel sistema.

---

# Portale Verifiche

Il Portale Verifiche è un'applicazione separata, accessibile tramite URL dedicato.

Requisiti:

* design moderno, responsivo, mobile-first;
* schermata di accesso essenziale: selezione verifica, inserimento dati studente;
* schermata di svolgimento in fullscreen con tutte le domande in sequenza verticale;
* ogni domanda mostra: tipo, difficoltà, peso, punteggio massimo e campo risposta;
* header sticky con nome studente e bottone "Consegna" sempre visibile;
* deterrenza di base: fullscreen obbligatorio, rilevamento uscita tab con avviso visibile, copia-incolla disabilitato nella UI;
* zero menu, zero navigazione, zero elementi non necessari durante lo svolgimento.

La deterrenza non è sicurezza: un'uscita dal tab non annulla la verifica. Il docente è l'anti-cheat reale.

---

# Classi e Studenti

Gli studenti non si registrano al sistema e non hanno un account SchoolForge.

Il riconoscimento avviene tramite email scolastica Google inserita al momento dell'accesso alla verifica. Non è richiesta alcuna pre-registrazione.

Il campo classe è facoltativo: lo studente può inserirlo al momento del download/accesso. Non è bloccante.

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

---

# Correzione Assistita AI

La correzione AI è un modulo successivo, dipendente dalle decisioni C-02 e C-03.

Richiede consegne digitali strutturate (Portale Verifiche).

## Obiettivo

Ridurre il tempo di correzione del docente mantenendo la governance del processo in mano al docente.

## Modalità Assistita

L'AI propone punteggio, motivazione e commento per ogni risposta.

Il docente approva, modifica o rifiuta ogni proposta individualmente o in blocco.

## Modalità Automatica

L'AI assegna e approva automaticamente la correzione.

Attivabile solo con opt-in esplicito del docente per la specifica verifica.

Ogni esito automatico è marcato come tale e rimane modificabile.

## Rilevamento Anomalie Stilistiche

Il sistema può segnalare risposte stilisticamente incoerenti con il profilo dello studente.

La segnalazione è consultiva: non blocca la correzione e non penalizza automaticamente lo studente.

## Contesto di Correzione

L'AI utilizza esclusivamente:

* lezione sorgente;
* domanda;
* soluzione;
* risposta dello studente.

Nessuna fonte web. Nessun retrieval esterno.

La correzione valorizza:

* approfondimenti corretti;
* terminologia tecnica appropriata;
* spiegazioni equivalenti;
* conoscenze superiori ai requisiti minimi.

---

# Roadmap

## Modulo 1

Repository Didattico: Programmi, UDA, lezioni, pool domande, rendering, export repository, programma svolto scaricabile.

---

## Modulo 2

Generazione Verifiche e PDF: verifica come configurazione, generazione on-demand, email bruciata, download docente senza limiti, Portale Verifiche canale cartaceo.

---

## Modulo 3

Portale Verifiche digitale: svolgimento online, consegne strutturate su Firestore.

---

## Modulo 4

Correzione manuale e percentuali: correzione consegne digitali, punteggi, percentuali, rettifiche tracciate.

---

## Modulo 5

Correzione Assistita AI: proposte assistite, approvazione massiva, modalità automatica opt-in, rilevamento anomalie stilistiche.

---

# Decisioni Aperte

Le seguenti decisioni non possono essere dedotte dal brief e richiedono una scelta esplicita del committente prima del relativo rilascio. Non devono essere sostituite da assunzioni tecniche nascoste.

| ID | Decisione | Impatto | Owner | Scadenza |
|---|---|---|---|---|
| C-01 | Regione Firebase, politica di backup, RPO, RTO e responsabilità operativa | Provisioning infrastruttura e go-live produzione | Committente / Responsabile operativo | Prima del go-live Modulo 1 |
| C-02 | Provider AI, condizioni contrattuali, residenza dei dati, consenso per l'invio di risposte degli studenti | Implementazione AiGateway e funzionalità AI | Committente | Prima del Modulo 5 |
| C-03 | Regola didattica per l'uso della correzione automatica, ambito di applicazione e eventuale revisione umana obbligatoria | Abilitazione modalità automatica | Committente / Docente | Prima dell'abilitazione modalità automatica (Modulo 5) |

Ogni decisione produce un verbale scritto nel repository che documenta: data, approvatore, opzioni valutate, scelta effettuata e vincoli operativi.

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

## Analytics Didattiche

Statistiche aggregate per classe, studente, UDA e argomento.

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
* Google Drive come storage del sistema;
* Google Forms come canale di erogazione;
* PDF conservati dal sistema;
* correzione di prove cartacee nel sistema;
* portale studenti con account e autenticazione propria;
* contenuti provenienti dal web come fonte didattica primaria.

---

# Definizione Finale

SchoolForge è un repository didattico Markdown-first che centralizza la conoscenza del docente e la utilizza come fonte unica per generare verifiche on-demand, supportare la correzione digitale e abilitare future analisi didattiche. La conoscenza rimane indipendente dalla piattaforma. Il PDF non viene mai conservato dal sistema. L'AI è una capacità opzionale e incrementale. Ogni modulo produce valore autonomo.
