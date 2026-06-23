# SchoolForge - Project Concept Brief

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

* programmi annuali;
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
* verifiche;
* soluzioni;
* rubriche;
* correzioni;
* archiviazione;
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

# Utenti

## Versione Iniziale

Un solo docente.

La V1 non prevede:

* multi-docente;
* multi-istituto;
* gestione organizzazioni.

---

## Studenti

Gli studenti non accedono al sistema.

Le verifiche vengono erogate tramite strumenti esterni.

---

# Prerequisiti di Deployment

L'uso di SchoolForge richiede i seguenti prerequisiti non negoziabili. In assenza di uno qualsiasi di questi, il sistema non può essere avviato o non può offrire le funzionalità previste.

## Google Workspace for Education

Il Docente deve disporre di un account Google Workspace for Education assegnato da un istituto scolastico.

Questo non è un vincolo tecnico aggirabile: è la scelta architetturale centrale del sistema.

Un account Google personale (@gmail.com) non è sufficiente.

Le funzionalità che dipendono da Google Workspace for Education includono:

* autenticazione del Docente;
* creazione e gestione di Google Forms per l'erogazione digitale delle verifiche (opzionale);
* importazione del roster classi/studenti tramite Google Classroom API (opzionale).

Le funzionalità che rimangono operative anche senza Google Workspace for Education non esistono: l'account Education è il prerequisito di accesso al sistema.

## Progetto Google Cloud / Firebase

È necessario un progetto Firebase su Google Cloud con i seguenti servizi abilitati:

* Firebase Authentication;
* Cloud Firestore;
* Cloud Storage;
* Cloud Functions v2;
* Secret Manager.

La decisione su regione, backup, RPO e RTO è documentata come C-01.

## Connessione internet

SchoolForge è un'applicazione web SPA con backend serverless. Non esiste una modalità offline.

---

# Contratto di Uscita

SchoolForge garantisce che la conoscenza didattica del Docente rimanga di sua proprietà e sia recuperabile indipendentemente dalla disponibilità della piattaforma.

## Cosa il Docente può sempre recuperare

* **File Markdown originali e asset**: esportabili in qualsiasi momento tramite la funzione "Export repository". Il file ZIP contiene i file nella struttura originale, leggibili con qualsiasi editor di testo, senza dipendenza da SchoolForge.
* **Snapshot delle Verifiche pubblicate**: i contenuti delle Verifiche (domande, soluzioni, rubriche, punteggi) sono conservati in Firestore. In caso di export Firestore, sono leggibili come documenti JSON standard.
* **Storico delle consegne e correzioni**: incluso nell'export Firestore.
* **Log di audit**: incluso nell'export Firestore.

## Cosa non viene recuperato in modo automatico

* Il rendering web delle lezioni (dipende dall'applicazione; il Markdown è autonomo).
* I PDF generati (devono essere stati caricati su Google Drive dal Docente; SchoolForge conserva solo il link).
* Le integrazioni Google (richiedono ri-configurazione OAuth in un nuovo sistema).

## Procedura di uscita

1. Eseguire "Export repository" dalla UI: produce un file ZIP con tutti i Markdown e gli asset correnti.
2. Richiedere un export Firestore dal pannello Google Cloud (dati operativi, verifiche, storico).
3. Scaricare i backup di Cloud Storage tramite `gsutil` o Cloud Console.
4. Revocare le autorizzazioni OAuth di SchoolForge dal pannello Google del proprio account.
5. Eliminare il progetto Firebase/Google Cloud se non più necessario.

Il punto 1 è sempre disponibile dalla UI. I punti 2–5 richiedono accesso alla console Google Cloud.

---

# Modello Concettuale

Programma

↓

UDA

↓

Lezioni

↓

Conoscenza Didattica

↓

Verifiche / Soluzioni / Archiviazione / Correzioni 

---

# Programmi

Un programma rappresenta una materia o un percorso didattico.

Esempi:

* TPSIT Terzo Anno
* TPSIT Quarto Anno
* Sistemi e Reti Terzo Anno

Un programma contiene una o più UDA.

---

# UDA

Le UDA rappresentano l'unità organizzativa principale.

Le UDA contengono lezioni.

Le verifiche possono essere generate:

* da una singola lezione;
* da più lezioni;
* da una o più UDA complete.

---

# Lezioni

Le lezioni sono file Markdown.

Le lezioni vengono create e modificate esternamente al sistema.

La V1 non prevede editor integrato.

Il sistema deve permettere:

* upload file singoli;
* upload cartelle;
* sostituzione file;
* eliminazione file.

---

# Contenuto Minimo delle Lezioni

Ogni lezione deve poter contenere almeno:

* contenuto didattico;
* immagini;
* obiettivi;
* domande di autoverifica;
* domande di verifica.

La struttura sintattica definitiva verrà definita durante l'analisi dei requisiti.

---

# Presentazione delle Lezioni

Il sistema deve poter visualizzare le lezioni tramite rendering Markdown.

Requisiti:

* design moderno;
* tema chiaro;
* tema scuro;
* supporto immagini;
* visualizzazione domande autoverifica;
* esclusione domande verifica.

Non è richiesta una modalità slide.

Il rendering della lezione è sufficiente.

---

# Generazione Verifiche

Le verifiche vengono generate a partire dalla conoscenza selezionata.

L'utente deve poter selezionare:

* una o più UDA;
* una o più lezioni.

L'utente deve poter definire:

* numero totale domande;
* numero domande aperte;
* numero domande chiuse;
* difficoltà;
* numero versioni.

---

# Origine delle Domande

Le domande possono provenire da:

## Domande Archiviate

Domande già presenti nelle lezioni.

## Domande Generate

Domande generate tramite AI.

Le domande generate devono basarsi esclusivamente sulle lezioni selezionate.

L'utilizzo di conoscenza proveniente dal web è esplicitamente escluso.

---

# Soluzioni e Rubriche

Per ogni verifica il sistema deve poter generare:

* soluzione completa;
* rubrica di correzione.

Tali elementi possono essere:

* presenti nelle lezioni;
* generati dall'AI.

---

# Formati di Esportazione

Una verifica può essere esportata come:

* PDF;
* Google Forms;
* entrambi.

---

# Google Forms

Google Forms rappresenta il canale principale di erogazione digitale.

Gli studenti compilano il modulo tramite account Google.

L'identificazione dello studente deve essere possibile.

---

# Classi e Studenti

Gli studenti non possiedono un account SchoolForge e non si registrano al sistema.

Il sistema non richiede una pre-registrazione degli studenti. Il record di uno studente viene creato automaticamente al momento della prima risposta riconoscibile (email raccolta da Google Forms). Classi e dati anagrafici completi sono facoltativi e possono essere aggiunti in seguito.

I dati di classe e studente servono esclusivamente per:

* archiviazione;
* tracciabilità;
* consultazione dello storico.

---

# Archiviazione

L'archiviazione è un modulo autonomo.

L'archiviazione non dipende dall'AI.

---

# Obiettivo dell'Archiviazione

Garantire massima tracciabilità delle prove svolte.

---

# Dati da Conservare

Per ogni prova devono poter essere conservati:

* verifica;
* versione della verifica;
* studente;
* classe;
* data;
* risposte;
* commenti;
* punteggi;
* voto finale.

---

# Output Archiviabili

Il sistema deve poter generare PDF archiviabili.

---

# Correzione Assistita AI

La correzione AI è un modulo successivo all'archiviazione.

---

# Obiettivo

Ridurre il tempo di correzione del docente.

---

# Modalità Assistita

L'AI:

* propone punteggio;
* propone motivazione;
* propone commento.

Il docente approva o modifica.

---

# Modalità Automatica

L'AI può:

* assegnare il punteggio;
* approvare automaticamente la correzione.

Entrambe le modalità devono essere considerate possibili.

---

# Contesto di Correzione

L'AI deve poter utilizzare:

* lezione;
* domanda;
* soluzione;
* rubrica;
* risposta dello studente.

La correzione non deve limitarsi al confronto con la soluzione.

Devono essere valorizzati:

* approfondimenti corretti;
* terminologia tecnica;
* spiegazioni equivalenti;
* conoscenze superiori rispetto ai requisiti minimi.

---

# Roadmap

## Modulo 1

Repository Didattico.

---

## Modulo 2

Generazione Verifiche e PDF.

---

## Modulo 3

Correzione manuale e percentuali.

---

## Modulo 4

Archiviazione, classi e storico.

---

## Modulo 5

Correzione Assistita AI.

---

# Decisioni Aperte

Le seguenti decisioni non possono essere dedotte dal brief e richiedono una scelta esplicita del committente prima del relativo rilascio. Non devono essere sostituite da assunzioni tecniche nascoste.

| ID | Decisione | Impatto | Owner | Scadenza |
|---|---|---|---|---|
| C-01 | Regione Google Cloud, politica di backup, RPO, RTO e responsabilità operativa | Provisioning infrastruttura e go-live produzione | Committente / Responsabile operativo | Prima del go-live Modulo 1 |
| C-02 | Provider AI, condizioni contrattuali, residenza dei dati, consenso per l'invio di risposte degli studenti | Implementazione AiGateway e funzionalità AI | Committente | Prima del Modulo 4 AI |
| C-03 | Regola didattica per l'uso della correzione automatica, ambito di applicazione e eventuale revisione umana obbligatoria | Abilitazione modalità automatica (feature flag) | Committente / Docente | Prima dell'abilitazione modalità automatica |

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

## Portale Studente

Accesso diretto degli studenti.

---

## Analytics Didattiche

Statistiche aggregate.

---

## Profilo Studente Assistito da AI

Analisi dello storico delle verifiche.

Produzione di:

* punti di forza;
* punti di debolezza;
* andamento nel tempo;
* suggerimenti di studio;
* sintesi delle competenze.

L'obiettivo non è il semplice storico dei voti.

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
* contenuti provenienti dal web come fonte didattica primaria.

---

# Definizione Finale

SchoolForge è un repository didattico Markdown-first che centralizza la conoscenza del docente e la utilizza come fonte unica per generare lezioni, verifiche, archiviazione e future analisi didattiche, mantenendo la conoscenza indipendente dalla piattaforma e trattando l'AI come capacità opzionale e incrementale.
