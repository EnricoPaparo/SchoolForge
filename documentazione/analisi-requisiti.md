# SchoolForge — Analisi dei requisiti

**Versione:** 4.0
**Data:** 24 giugno 2026
**Stato:** baseline funzionale approvata
**Input vincolante:** `documentazione/brief.md`
**Output successivo:** piano di implementazione

---

## 1. Scopo, autorità e convenzioni

Questo documento trasforma il brief in requisiti di prodotto verificabili. Definisce comportamenti, dati, vincoli e criteri di accettazione; non impone framework, database, cloud o provider AI.

In caso di conflitto prevalgono: obblighi di legge applicabili, decisioni esplicite del brief, questa analisi, architettura e implementazione.

| Prefisso | Significato |
|---|---|
| FR | Requisito funzionale |
| BR | Regola di business |
| NFR | Requisito non funzionale |
| AC | Criterio di accettazione |
| C | Decisione di esercizio ancora necessaria |

### 1.1 Decisioni applicate in questa baseline

| ID | Decisione | Conseguenza nei requisiti |
|---|---|---|
| D-01 | L'email dello studente è un recapito e un lock di tentativo, non un'identità verificata. | Nessuna autenticazione, verifica di possesso o controllo di dominio nel Portale. |
| D-02 | Il docente non dipende da Google Workspace for Education. | Firebase Authentication gestisce l'accesso docente; Google Workspace non è richiesto. |
| D-03 | Non serve ricreare una verifica passata dopo modifiche alle lezioni. | Non è richiesto versionare l'intero repository. La configurazione resta immutabile; una consegna digitale conserva le domande effettivamente mostrate. |
| D-04 | La generazione AI di domande è eliminata. | I pool Markdown sono l'unica fonte delle domande. L'AI rimane solo nel Modulo 5 per la correzione. |
| D-05 | Il sistema non invia email agli studenti. | Il canale cartaceo genera il PDF direttamente nel browser dello studente; nessun provider email è richiesto nei Moduli 1–4. |
| D-06 | PDF, export e programma svolto sono generati nel browser. | Nessuna Cloud Function per la generazione di documenti; `@react-pdf/renderer` nel client. |
| D-07 | Le classi sono una lista configurabile dal docente. | La lista è usata nelle impostazioni verifica e come menu a tendina nel portale studente. |
| D-08 | C-01 formalizzata. | Firebase; dati applicativi in Milano `europe-west8`; backup giornaliero; RPO 24 ore; RTO best-effort; Docente responsabile operativo. |

## 2. Visione, obiettivi e perimetro

SchoolForge è un repository didattico personale, Markdown-first e knowledge-first, per un solo docente. La conoscenza vive in file Markdown portabili. Il sistema la consulta, valida, organizza e usa per presentare lezioni, comporre verifiche, raccogliere consegne digitali e assistere facoltativamente la correzione.

### 2.1 Obiettivi

1. Conservare la conoscenza didattica in un formato autonomo, esportabile e leggibile senza SchoolForge.
2. Evitare duplicazioni tra lezioni, questionari, verifiche e correzioni.
3. Generare verifiche coerenti con fonti, tipi, difficoltà e pesi scelti dal docente.
4. Consentire un canale cartaceo con download PDF diretto e un canale digitale strutturato, senza account studenti.
5. Mantenere il docente responsabile di attivazione, correzione e decisioni valutative.
6. Rendere l'AI opzionale, confinata e incapace di bloccare i flussi manuali.

### 2.2 Perimetro incluso

| Area | Capacità |
|---|---|
| Repository didattico | Programmi, UDA, lezioni, pool, asset, rendering, export ZIP e programma svolto. |
| Verifiche | Configurazione, classi, selezione da pool, punteggi, varianti, attivazione e PDF on-demand nel browser. |
| Portale Verifiche | Download PDF diretto allo studente (canale cartaceo) oppure svolgimento digitale senza account. |
| Correzione ed export | Consultazione consegne digitali, punteggi manuali, percentuale, rettifiche tracciate ed export in PDF/Markdown/CSV. |
| AI successiva | Proposte di correzione, correzione automatica con opt-in e rapporto consultivo sulle anomalie stilistiche. |

### 2.3 Fuori scope vincolante

Registro elettronico, presenze, compiti, chat, forum, videolezioni, LMS, social learning, multi-docente, multi-istituto, editor Markdown integrato, account studenti, correzione di prove cartacee, PDF archiviati, invio email agli studenti, fonti web per l'AI e generazione AI delle domande non devono apparire come dipendenze o funzionalità dei moduli previsti.

## 3. Utenti, ruoli e identità

| Ruolo | Descrizione | Permessi |
|---|---|---|
| Docente proprietario | Unico utente applicativo della V1. | Gestisce contenuti, classi, verifiche, consegne, correzioni, export e impostazioni AI. |
| Studente | Utente anonimo del solo link di una verifica. | Dichiara dati minimi, scarica il PDF oppure svolge e consegna nel Portale. |
| Servizi esterni | Dal Modulo 5, il provider AI. | Riceve solo i dati strettamente necessari alla correzione. |

**FR-AUTH-01.** Il pannello del Docente deve usare Firebase Authentication con un provider configurato nell'ambiente. Il provider deve restituire un identificatore stabile e deve consentire di limitare l'accesso al solo Docente proprietario della V1, senza richiedere Google Workspace for Education.

**FR-AUTH-02.** La V1 non prevede registrazione, invito, delega o ruolo per altri docenti.

**BR-AUTH-01.** Il Portale Verifiche non autentica lo studente. Nome, cognome, email e classe sono dichiarazioni dell'utente e non sono attribuiti a un'identità verificata.

**BR-AUTH-02.** L'email è normalizzata solo per applicare il lock del tentativo: rimozione degli spazi esterni e confronto case-insensitive. Il sistema non valida dominio, titolare o appartenenza a una classe.

**NFR-AUTH-01.** Soluzioni, opzioni corrette, dati di correzione e funzioni del Docente non devono essere esposti dal Portale o da URL studente.

## 4. Modello di dominio

| Entità | Definizione |
|---|---|
| Programma | Materia o percorso didattico, contenitore di una o più UDA. |
| UDA | Unità organizzativa rappresentata da un file `uda-XX-titolo.md`; contiene lezioni per posizione in cartella. |
| Lezione | File `lezione-XXX-titolo.md` con contenuto didattico e, facoltativamente, file `.pool.md`. |
| Pool | Insieme strutturato di domande di una lezione, non visualizzato nel rendering della lezione. |
| Classe | Voce della lista configurata dal docente nelle impostazioni; usata nelle verifiche e nel portale. |
| Verifica | Configurazione che seleziona fonti, classi e regole di estrazione; non è un PDF conservato. |
| Istanza digitale | Snapshot della verifica effettivamente assegnato a un tentativo digitale, con le sole informazioni necessarie a svolgimento, correzione ed export. |
| Tentativo | Accesso di uno studente a una verifica per un canale; è associato a un solo recapito normalizzato. |
| Consegna | Risposte inviate in modo definitivo nel canale digitale. |
| Correzione | Punteggi, commenti, percentuale e relative rettifiche. |

**BR-DOM-01.** I riferimenti tecnici devono usare identificatori stabili, non titoli o nomi file. Rinominare un contenuto non può creare riferimenti orfani.

**BR-DOM-02.** Una lezione senza pool è valida e visualizzabile, ma non fornisce domande per la generazione delle verifiche.

**BR-DOM-03.** Il sistema non è un archivio di versioni dei Markdown. File e asset correnti sono la conoscenza corrente; l'export repository restituisce tale stato corrente.

## 5. Repository didattico e programma svolto — Modulo 1

**FR-REP-01.** Il docente deve poter creare e gestire Programmi, importare UDA, lezioni, pool e asset mediante upload di file singoli o cartelle.

**FR-REP-02.** Il sistema deve eseguire la validazione del contratto `lesson-contract` prima di rendere disponibili i file importati. Un errore in un pool non rende non valida la lezione, ma il pool non è selezionabile finché non viene corretto.

**FR-REP-03.** Il docente deve poter sostituire o eliminare file e cartelle. Prima dell'azione il sistema deve indicare gli elementi interessati e l'effetto sulle verifiche future.

**FR-REP-04.** Il rendering della lezione deve supportare Markdown e immagini, tema chiaro e scuro, e domande di autoverifica presenti nel file lezione. Non deve renderizzare il file `.pool.md`.

**FR-REP-05.** Il sistema deve produrre un ZIP con i Markdown e gli asset correnti nella struttura importata, senza trasformarli in formato proprietario.

**FR-REP-06.** Il docente deve poter selezionare UDA e lezioni svolte e scaricare il programma svolto in due formati: Markdown e PDF. Entrambi i file vengono generati on-demand nel browser e non sono conservati dal sistema.

**BR-REP-01.** Il sistema non modifica semanticamente il Markdown importato. I metadati operativi sono conservati separatamente dai file originali.

**AC-REP-01.** Data una UDA con una lezione valida e un pool non valido, il rendering della lezione funziona e la UI mostra gli errori del pool con file, domanda e campo interessati.

**AC-REP-02.** Dato un repository con asset e cartelle annidate, l'export ZIP mantiene file, nomi e relazioni di percorso leggibili fuori da SchoolForge.

## 6. Contratto Markdown e pool domande v1

### 6.1 UDA e lezione

**BR-MD-01.** Il file UDA deve chiamarsi `uda-XX-titolo.md` e dichiarare nel front matter YAML almeno `titolo`, `competenze` e `obiettivi`. `competenze` e `obiettivi` sono liste di stringhe non vuote.

**BR-MD-02.** Una lezione deve chiamarsi `lezione-XXX-titolo.md`. Il contenuto Markdown è libero; il sistema non richiede un editor né impone una struttura didattica aggiuntiva.

### 6.2 Formato del pool

Ogni pool usa il nome della lezione con suffisso `.pool.md` e contiene solo il seguente front matter YAML.

```md
---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    difficolta: media
    peso: alto
    testo: |
      Spiega la differenza tra HTTP e HTTPS.
    soluzione: |
      HTTPS aggiunge un canale cifrato con autenticazione del server.
  - id: q-002
    tipo: chiusa_singola
    difficolta: bassa
    peso: medio
    testo: Quale protocollo risolve i nomi di dominio?
    opzioni:
      - id: a
        testo: DNS
      - id: b
        testo: DHCP
    soluzione: [a]
---
```

**BR-POOL-01.** `schema` deve essere esattamente `schoolforge-pool/v1`; `questions` è una lista, anche quando contiene una sola domanda.

**BR-POOL-02.** Ogni domanda richiede `id`, `tipo`, `difficolta`, `peso`, `testo` e `soluzione`. L'`id` è univoco nel singolo pool, composto da lettere minuscole, cifre e trattini.

**BR-POOL-03.** I valori ammessi sono: `tipo` = `aperta`, `chiusa_singola`, `chiusa_multipla`; `difficolta` = `bassa`, `media`, `alta`; `peso` = `basso`, `medio`, `alto`.

**BR-POOL-04.** Una domanda `aperta` usa `soluzione` come testo Markdown non vuoto e non dichiara `opzioni`. Una domanda chiusa dichiara almeno due `opzioni`, ognuna con `id` e `testo` univoci. Per `chiusa_singola`, `soluzione` contiene un solo id di opzione; per `chiusa_multipla` contiene da uno a un numero di id inferiore al numero di opzioni.

**BR-POOL-05.** Campi sconosciuti sono rifiutati nella versione v1. Un pool non valido è interamente escluso dalla selezione.

**BR-POOL-06.** Il punteggio massimo della domanda è `coeff_difficolta × coeff_peso`, con bassa/basso = 0,75, media/medio = 1,00 e alta/alto = 1,25.

**AC-POOL-01.** Un pool con due `id` uguali, una soluzione chiusa inesistente o un valore di difficoltà non ammesso viene rifiutato indicando la riga o il percorso YAML e la causa.

**AC-POOL-02.** Un pool valido con domanda aperta e domanda chiusa singola diventa selezionabile e non compare nel rendering della lezione.

## 7. Classi — configurazione docente

**FR-CLS-01.** Il docente deve poter gestire la lista delle proprie classi nelle impostazioni dell'applicazione: aggiungere, rinominare ed eliminare voci.

**FR-CLS-02.** La lista classi è disponibile come selezione multipla nella configurazione di una verifica (campo opzionale).

**FR-CLS-03.** Nel Portale Verifiche, il campo classe deve mostrare un menu a tendina con le voci configurate dal docente. Il campo è sempre facoltativo per lo studente.

**BR-CLS-01.** L'eliminazione di una classe dalle impostazioni non modifica le verifiche già configurate: il valore storico rimane nei record esistenti come stringa.

## 8. Configurazione e selezione delle verifiche — Modulo 2

### 8.1 Configurazione e stati

**FR-VER-01.** Il docente crea una verifica con: titolo, una o più UDA e/o lezioni sorgenti, numero totale di domande, tipi ammessi, difficoltà ammesse e minimo per ciascuna difficoltà scelta, modalità variante e canale o canali abilitati, e classi associate (opzionale).

**BR-VER-01.** Una verifica percorre gli stati `bozza`, `attiva`, `chiusa`, `archiviata`. Solo la bozza è modificabile. L'attivazione rende immutabile la configurazione; la chiusura impedisce nuovi tentativi; l'archiviazione la nasconde dalle normali viste operative senza eliminare le consegne digitali.

**BR-VER-02.** Non sono richiesti calendario, durata configurabile, cronometro o chiusura automatica nella V1.

**BR-VER-03.** Il sistema blocca l'attivazione se non esistono fonti selezionate, tipi o difficoltà ammessi, se il totale è minore di uno, se la somma dei minimi supera il totale oppure se il pool corrente non contiene abbastanza domande eleggibili.

**BR-VER-04.** Le impostazioni attivate non cambiano. Le lezioni e i pool possono evolvere: una nuova generazione per uno studente che non ha ancora iniziato usa i contenuti correnti.

### 8.2 Algoritmo di selezione

**BR-SEL-01.** Il sistema raccoglie domande valide delle fonti selezionate, filtra per tipo e difficoltà ammessi, soddisfa i minimi di difficoltà e completa fino al totale usando solo domande non ancora scelte. La stessa domanda non può comparire due volte nella stessa istanza.

**BR-SEL-02.** Per `tutte_uguali`, il sistema usa un seme stabile della verifica. Per `tutte_diverse`, il seme deriva da verifica ed email normalizzata.

**BR-SEL-03.** Se una modifica successiva all'attivazione rende impossibile generare una nuova istanza conforme, la richiesta è rifiutata con un messaggio che indica il vincolo non soddisfatto.

### 8.3 PDF verifica

**FR-VER-02.** Il PDF studente (generato nel browser) contiene titolo, nome, cognome, email, classe se dichiarata, data del giorno, domande, punteggio massimo e spazio di risposta. Non espone soluzioni o opzioni corrette.

**FR-VER-03.** Il docente può generare e scaricare un PDF in ogni momento. Nome, cognome, email e classe sono vuoti e compilabili a mano; la data non è presente. Questo download non crea tentativi né brucia email.

**AC-VER-01.** Una configurazione con totale 8 e minimi 3 bassa, 3 media, 3 alta non può essere attivata.

**AC-VER-02.** Il download docente non persiste PDF e non modifica il registro dei tentativi.

## 9. Portale Verifiche — canale cartaceo — Modulo 2

**FR-PAP-01.** Dopo aver inserito nome, cognome, email e classe facoltativa, lo studente riceve il PDF della verifica direttamente come download nel browser, generato da `@react-pdf/renderer` senza passare per il server.

**FR-PAP-02.** Il lock del recapito è creato in transazione Firestore prima della generazione del PDF. Se la transazione fallisce (email già usata), il PDF non viene generato.

**BR-PAP-01.** L'email è bruciata per la coppia `verifica + recapito normalizzato` indipendentemente dal canale scelto. Dopo un download cartaceo riuscito, lo stesso recapito non può ottenere un secondo PDF né avviare il canale digitale per la stessa verifica.

**AC-PAP-01.** Due richieste concorrenti con lo stesso recapito per la stessa verifica producono un solo download PDF; la seconda riceve errore esplicito.

**AC-PAP-02.** Dopo il download cartaceo, il recapito risulta bloccato per tutti i canali della stessa verifica.

## 10. Portale Verifiche digitale — Modulo 3

### 10.1 Avvio e tentativo

**FR-POR-01.** Il link di una verifica attiva mostra esclusivamente i dati essenziali e la scelta del canale. Per il canale digitale lo studente inserisce nome, cognome, email e classe facoltativa.

**FR-POR-02.** All'avvio digitale la Cloud Function `startDigitalAttempt` crea in transazione lock, tentativo, snapshot con soluzioni private e token opaco di sessione consegnato come cookie sicuro. Il client riceve solo la proiezione delle domande senza soluzioni.

**BR-POR-01.** Da quando un tentativo digitale è avviato, l'email è bruciata anche se la consegna non viene completata.

### 10.2 Svolgimento, salvataggio e consegna

**FR-POR-03.** Il Portale mostra le domande in sequenza verticale. Ogni domanda espone tipo, difficoltà, peso, punteggio massimo e un controllo di risposta coerente con il tipo.

**FR-POR-04.** Le risposte devono essere salvate automaticamente come bozza. Un refresh nello stesso browser deve consentire la ripresa del tentativo senza assegnare nuove domande.

**FR-POR-05.** L'header sticky mostra il nome dichiarato e il comando `Consegna`. Prima della consegna il sistema richiede conferma e segnala le domande senza risposta.

**BR-POR-02.** La consegna definitiva rende immutabili risposte e snapshot dell'istanza.

**BR-POR-03.** Il Portale non contiene menu, link esterni, soluzioni, risultati, voti o storico dello studente.

### 10.3 Deterrenza realistica

**FR-POR-06.** Il Portale deve richiedere fullscreen, mostrare un avviso persistente in caso di uscita dal fullscreen o cambio scheda e disabilitare copia-incolla nella propria UI.

**BR-POR-04.** Fullscreen, rilevamento tab e blocco copia-incolla sono deterrenti, non sicurezza. L'uscita dal tab non annulla il tentativo.

**AC-POR-01.** Uno studente avvia una prova digitale, ricarica la pagina nello stesso browser e ritrova le stesse domande e le risposte salvate.

**AC-POR-02.** Dopo la consegna, il docente può consultare testo domanda, soluzione, risposta, dati dichiarati e timestamp; lo studente non può modificare né rivedere la consegna nel Portale.

## 11. Correzione manuale e percentuali — Modulo 4

**FR-COR-01.** Il docente può filtrare le consegne digitali per verifica, stato di correzione, recapito, nome dichiarato, classe e data.

**FR-COR-02.** Per ogni consegna il docente visualizza domanda, soluzione, risposta, punteggio massimo e dati dichiarati. Può assegnare a ogni domanda un punteggio da zero al massimo e un commento opzionale.

**FR-COR-03.** Il sistema calcola `somma punti assegnati / somma punti massimi × 100`. Finché esiste una domanda priva di punteggio definitivo, la percentuale è `non definitiva`.

**BR-COR-01.** SchoolForge non converte percentuali in voti e non scrive nel registro elettronico.

**FR-COR-04.** Il docente può rettificare punteggio o commento. Ogni rettifica registra autore, data, valore precedente, valore nuovo e motivazione obbligatoria; il log è append-only.

**FR-DAT-01.** Il docente deve poter eliminare una consegna digitale. L'operazione richiede conferma, rimuove dati personali, risposte e correzioni; conserva un evento di audit non identificativo con data e motivazione.

**BR-DAT-01.** La V1 non stabilisce una durata di conservazione automatica. La responsabilità della politica di conservazione rimane del docente.

### 11.1 Esportazione globale delle verifiche svolte

**FR-EXP-01.** Il docente dispone del comando `Esporta verifiche` che genera on-demand nel browser un documento scaricabile contenente tutte le consegne digitali definitive non annullate e non eliminate.

**FR-EXP-02.** L'export è costruito dagli snapshot digitali, non dal Markdown o dal pool corrente.

**FR-EXP-03.** Il docente sceglie il formato al momento dell'export: **PDF** (documento unico), **Markdown** (portabile) o **CSV** (compatibile con Excel/Sheets). Il contenuto è identico nei tre formati.

**BR-EXP-01.** Per ogni consegna esportata il documento include almeno: titolo della verifica, identificativo tentativo, data e ora consegna, nome, cognome, email e classe se presenti; per ogni domanda, testo, tipo, difficoltà, peso, punteggio massimo e risposta; punteggio assegnato, commento, totale e percentuale quando disponibili.

**BR-EXP-02.** Le consegne nell'export sono ordinate per verifica e, al suo interno, per data di consegna. Le consegne annullate, eliminate o ancora in bozza non vengono incluse.

**BR-EXP-03.** L'export è generato on-demand nel browser del docente e non viene conservato dal sistema.

**AC-EXP-01.** Date consegne definitive di verifiche diverse, una consegna annullata e una bozza non consegnata: il documento contiene tutte e sole le consegne definitive, ordinate per verifica e data.

**AC-EXP-02.** Dopo la modifica del Markdown sorgente, l'export di una consegna già effettuata mostra le stesse domande e risposte dell'istanza svolta.

**AC-COR-01.** Dopo l'attribuzione dei punteggi a tutte le domande, la percentuale usa due decimali.

**AC-COR-02.** Una rettifica conserva valori, autore, data e motivazione e ricalcola la percentuale senza sovrascrivere la storia.

## 12. Correzione assistita AI — Modulo 5

**FR-AI-01.** In modalità assistita, l'AI può proporre punteggio, motivazione, commento e spiegazione degli errori. Il docente può approvare, modificare o rifiutare ogni proposta singolarmente o in blocco.

**FR-AI-02.** In modalità automatica, l'AI può rendere definitiva una proposta solo con opt-in esplicito del docente per la specifica verifica. Ogni esito resta modificabile e marcato come `automatico`.

**FR-AI-03.** Il docente può fornire una nota testuale di correzione per la specifica verifica, inviata all'AI solo per le correzioni associate.

**BR-AI-01.** Il contesto AI è limitato a lezione sorgente corrente, domanda dell'istanza, soluzione, risposta dello studente e nota docente. Web, retrieval esterno, tool e generazione di nuove domande sono vietati.

**BR-AI-02.** L'AI non può attivare verifiche, modificare Markdown, eliminare dati o annullare consegne.

**BR-AI-03.** Se manca uno degli elementi necessari al contesto, l'item non è inviato all'AI e richiede correzione manuale.

**FR-AI-04.** Il rapporto anomalie stilistiche è esclusivamente consultivo per il docente: non modifica punteggi né blocca la correzione. Se non esiste un corpus sufficiente, il sistema dichiara `riferimenti insufficienti`.

**NFR-AI-01.** Per ogni elaborazione AI il sistema registra finalità, docente, verifica, item coinvolti, provider/modello, versione istruzioni, timestamp, esito, proposta e azione umana. Non registra nei log copie aggiuntive delle risposte.

**AC-AI-01.** Una proposta non approvata non altera punteggi. Un'approvazione massiva applica solo gli item completi e registra gli item inclusi.

## 13. Requisiti trasversali

### 13.1 Integrità e sicurezza

**NFR-SEC-01.** Tutti i dati personali, risposte, punteggi e credenziali devono essere protetti in transito e a riposo. Segreti non devono comparire in Markdown, export o telemetria.

**NFR-SEC-02.** Il Portale deve limitare tentativi ripetuti e richieste abusive sul link della verifica.

**NFR-SEC-03.** Le operazioni che eliminano dati, attivano o chiudono una verifica, annullano un tentativo o abilitano la correzione automatica richiedono conferma esplicita.

**NFR-INT-01.** Devono essere tracciati almeno: importazione, validazione, sostituzione, eliminazione, configurazione, attivazione, chiusura, avvio tentativo, download cartaceo, consegna, correzione, rettifica, annullamento e operazioni AI.

**NFR-INT-02.** I log di audit non sono modificabili dalla UI ordinaria e non devono contenere la risposta completa dello studente.

**NFR-INT-03.** Firestore, Storage e Functions usano Milano `europe-west8` ove il servizio lo supporta.

**NFR-INT-04.** Firestore e Cloud Storage devono essere inclusi in un backup giornaliero con conservazione minima di 30 giorni. RPO 24 ore; RTO best-effort.

### 13.2 Dati e portabilità

**NFR-DAT-01.** Il sistema raccoglie nel Portale soltanto nome, cognome, email, classe facoltativa e le risposte necessarie ai canali scelti.

**NFR-DAT-02.** I dati operativi devono essere esportabili in formati standard. `Esporta verifiche` è l'export didattico globale in PDF, Markdown o CSV.

**NFR-DAT-03.** L'applicazione non certifica la base giuridica del trattamento. Deve però rendere visibili i dati inviati al provider AI e consentire al docente di non usarla.

### 13.3 Esperienza, accessibilità e operatività

**NFR-UX-01.** La sezione docente è desktop-first; il Portale è mobile-first. Stati, errori e blocchi indicano causa e azione correttiva.

**NFR-ACC-01.** Target: WCAG 2.2 livello AA per struttura semantica, tastiera, focus, contrasto, alternative testuali e messaggi di errore.

**NFR-OPS-01.** Devono essere osservabili errori di importazione, rendering, generazione PDF, consegna e AI, senza inviare dati personali non necessari alla telemetria.

**NFR-COST-01.** L'architettura privilegia servizi managed e scale-to-zero. Cloud Functions usate solo per sessione digitale (M3) e AI (M5). Prima del go-live il Docente configura budget e avvisi di spesa.

## 14. Roadmap e dipendenze

| Modulo | Capacità rilasciata | Dipendenze | Uscita verificabile |
|---|---|---|---|
| 1. Repository didattico | Programmi, UDA, lezioni, pool, rendering, ZIP, programma svolto (PDF + Markdown). | Accesso docente e validatore pool. | Funziona senza Portale, AI o correzione. |
| 2. Verifiche e cartaceo | Configurazione, classi, selezione da pool, PDF browser, download docente e studente, email bruciata. | Modulo 1. | Vincoli validati, PDF non archiviato, recapito bruciato. |
| 3. Portale digitale | Istanza, snapshot via Function, bozza, ripresa, consegna e deterrenza. | Modulo 2. | Una consegna strutturata è consultabile dal docente. |
| 4. Correzione manuale ed export | Punteggi, percentuale, rettifiche, eliminazione consegna ed export PDF/Markdown/CSV. | Modulo 3. | Percentuali, audit ed export da snapshot verificabili. |
| 5. Correzione AI | Proposte, approvazioni, opt-in automatico e rapporto consultivo. | Modulo 4, C-02 e C-03. | I flussi manuali restano operativi senza AI. |

**BR-REL-01.** Nessun modulo successivo può diventare prerequisito del precedente.

## 15. Decisioni di esercizio

### 15.1 C-01 formalizzata

| Voce | Decisione |
|---|---|
| Provider | Firebase, progetto di proprietà del Docente. |
| Regione dati | Milano `europe-west8`, ove supportata. |
| Backup | Giornaliero per Firestore e Cloud Storage, conservazione minima 30 giorni. |
| RPO | 24 ore. |
| RTO | Best-effort. |
| Responsabile operativo | Docente. |

### 15.2 Decisioni residue

| ID | Decisione | Owner | Scadenza | Effetto se assente |
|---|---|---|---|---|
| C-02 | Provider AI, condizioni contrattuali, residenza dati. | Docente. | Prima del Modulo 5. | Modulo 5 disabilitato; gli altri moduli restano validi. |
| C-03 | Regola didattica per la correzione automatica. | Docente. | Prima di abilitare la modalità automatica. | Rimane disponibile solo la modalità assistita. |

## 16. Criteri globali di accettazione

La futura architettura e l'implementazione sono conformi solo se dimostrano con test e flussi completi che:

1. Markdown e asset restano esportabili e leggibili senza SchoolForge;
2. un pool invalido non compromette la lezione ma non può generare domande;
3. la configurazione attivata è immutabile;
4. l'email è un recapito non verificato e viene bruciata in modo concorrente-sicuro tra i due canali;
5. il PDF cartaceo è generato nel browser senza persistenza e il download docente non altera il tentativo;
6. un tentativo digitale riprende nello stesso browser con le stesse domande e diventa immutabile alla consegna;
7. soluzioni e opzioni corrette non sono mai esposte al Portale;
8. percentuali e rettifiche sono calcolabili e tracciabili senza gestire voti;
9. l'AI non genera domande, non usa il web, non è necessaria ai flussi manuali;
10. `Esporta verifiche` include tutte e sole le consegne digitali definitive e usa gli snapshot svolti;
11. C-01 è applicata; C-02 e C-03 bloccano soltanto le funzionalità AI a cui si riferiscono.
