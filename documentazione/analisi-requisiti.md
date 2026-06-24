# SchoolForge — Analisi dei requisiti

**Versione:** 3.2
**Data:** 24 giugno 2026  
**Stato:** baseline funzionale approvabile
**Input vincolante:** `documentazione/brief.md`
**Output successivo:** bootstrap F-01 secondo il piano esecutivo

---

## 1. Scopo, autorità e convenzioni

Questo documento trasforma il brief in requisiti di prodotto verificabili. Definisce comportamenti, dati, vincoli e criteri di accettazione; non impone framework, database, cloud, provider di autenticazione o provider AI.

In caso di conflitto prevalgono: obblighi di legge applicabili, decisioni esplicite del brief, questa analisi, architettura e implementazione. Un requisito derivato può rendere una decisione operativa, ma non può cambiare il perimetro del prodotto.

| Prefisso | Significato |
|---|---|
| FR | Requisito funzionale |
| BR | Regola di business |
| NFR | Requisito non funzionale |
| AC | Criterio di accettazione |
| C | Decisione di esercizio ancora necessaria |

### 1.1 Decisioni applicate in questa baseline

| ID | Decisione ricevuta | Conseguenza nei requisiti |
|---|---|---|
| D-01 | L'email dello studente è un recapito, non un'identità verificata né un limite di tentativo. | Nessuna autenticazione, verifica di possesso, controllo di dominio o integrità dell'identità nel Portale. Il limite usa nome e cognome dichiarati. |
| D-02 | Il docente non dipende da Google Workspace for Education. | Firebase Authentication gestisce l'accesso del docente con il provider configurato; Google Workspace non è richiesto. |
| D-03 | Non serve ricreare una verifica passata dopo modifiche alle lezioni. | Non è richiesto versionare l'intero repository né rigenerare PDF passati. La configurazione resta immutabile; una consegna digitale conserva però le domande effettivamente mostrate, necessarie alla correzione. |
| D-04 | La generazione AI di domande è eliminata. | I pool Markdown sono l'unica fonte delle domande di verifica. L'AI rimane solo nel Modulo 5, per la correzione. |
| D-05 | Contratto pool e ciclo del Portale sono definiti da questa analisi. | Le sezioni 6 e 9 costituiscono la baseline da implementare e testare. |
| D-06 | C-01 è stata formalizzata. | Firebase è il provider; dati applicativi in Milano `europe-west8` ove supportato, backup giornaliero completo, RPO 24 ore, RTO best-effort e Docente responsabile operativo. |

### 1.2 Assunzione esplicita sul canale cartaceo

Il brief aggiornato chiarisce che l'email serve a ricevere la verifica cartacea. Pertanto il canale cartaceo invia il PDF all'indirizzo dichiarato; non offre un download diretto allo studente. Il docente conserva invece il download diretto senza limiti. L'unicità del tentativo usa nome e cognome normalizzati, non l'email. Questa scelta introduce un servizio di invio email come dipendenza di implementazione, ma non modifica la proprietà o la conservazione dei PDF: il sistema non li archivia.

## 2. Visione, obiettivi e perimetro

SchoolForge è un repository didattico personale, Markdown-first e knowledge-first, per un solo docente. La conoscenza vive in file Markdown portabili. Il sistema la consulta, valida, organizza e usa per presentare lezioni, comporre verifiche, raccogliere consegne digitali e assistere facoltativamente la correzione.

### 2.1 Obiettivi

1. Conservare la conoscenza didattica in un formato autonomo, esportabile e leggibile senza SchoolForge.
2. Evitare duplicazioni tra lezioni, questionari, verifiche e correzioni.
3. Generare verifiche coerenti con fonti, tipi, difficoltà e pesi scelti dal docente.
4. Consentire un canale cartaceo semplice e un canale digitale strutturato, senza account studenti.
5. Mantenere il docente responsabile di attivazione, correzione e decisioni valutative.
6. Rendere l'AI opzionale, confinata e incapace di bloccare i flussi manuali.

### 2.2 Perimetro incluso

| Area | Capacità |
|---|---|
| Repository didattico | Programmi, UDA, lezioni, pool, asset, rendering, export ZIP e programma svolto. |
| Verifiche | Configurazione, snapshot pubblicato, selezione da pool, punteggi, varianti, attivazione e PDF on-demand. |
| Portale Verifiche | Invio PDF al recapito dichiarato oppure svolgimento digitale senza account. |
| Correzione ed export | Consultazione consegne digitali, punteggi manuali, percentuale, rettifiche tracciate ed export globale delle verifiche svolte. |
| AI successiva | Proposte di correzione, correzione automatica con opt-in e rapporto consultivo sulle anomalie stilistiche. |

### 2.3 Fuori scope vincolante

Registro elettronico, presenze, compiti, chat, forum, videolezioni, LMS, social learning, multi-docente, multi-istituto, editor Markdown integrato, account studenti, correzione di prove cartacee, PDF archiviati, fonti web per l'AI e generazione AI delle domande non devono apparire come dipendenze o funzionalità dei moduli previsti.

## 3. Utenti, ruoli e identità

| Ruolo | Descrizione | Permessi |
|---|---|---|
| Docente proprietario | Unico utente applicativo della V1. | Gestisce contenuti, verifiche, invii, consegne, correzioni, export e impostazioni AI. |
| Studente | Utente anonimo del solo link di una verifica. | Dichiara dati minimi, riceve il PDF oppure svolge e consegna nel Portale; nome e cognome limitano il tentativo senza certificarne l'identità. |
| Servizi esterni | Servizi email e, dal Modulo 5, AI. | Ricevono solo i dati strettamente necessari alla singola operazione. |

**FR-AUTH-01.** Il pannello del Docente deve usare Firebase Authentication con un provider configurato nell'ambiente. Il provider deve restituire un identificatore stabile e deve consentire di limitare l'accesso al solo Docente proprietario della V1, senza richiedere Google Workspace for Education.

**FR-AUTH-02.** La V1 non prevede registrazione, invito, delega o ruolo per altri docenti. Un cambio del Docente proprietario è un'operazione amministrativa fuori dalla normale UI.

**BR-AUTH-01.** Il Portale Verifiche non autentica lo studente. Nome, cognome, email e classe sono dichiarazioni dell'utente e non sono attribuiti a un'identità verificata.

**BR-AUTH-02.** L'email può essere scolastica o personale ed è un recapito del canale cartaceo; non deve essere usata come chiave di lock, credenziale o controllo di appartenenza. Il sistema può rimuovere gli spazi esterni per l'invio, ma non deve validarne dominio, titolare o appartenenza a una classe.

**BR-ATT-01.** Il lock del tentativo usa `verifica + nome + cognome`. Nome e cognome sono normalizzati con trim, Unicode NFC, compressione degli spazi interni e confronto case-insensitive; gli accenti non vengono rimossi. La chiave salvata nel lock è un HMAC per ambiente, non il valore in chiaro.

**NFR-AUTH-01.** Soluzioni, opzioni corrette, dati di correzione e funzioni del Docente non devono essere esposti dal Portale o da URL studente.

## 4. Modello di dominio

| Entità | Definizione |
|---|---|
| Programma | Materia o percorso didattico, contenitore di una o più UDA. |
| UDA | Unità organizzativa rappresentata da un file `uda-XX-titolo.md`; contiene lezioni nella relativa cartella, ordinate dal manifesto del Programma. |
| Lezione | File `lezione-XXX-titolo.md` con contenuto didattico e, facoltativamente, file `.pool.md`. |
| Pool | Insieme strutturato di domande di una lezione, non visualizzato nel rendering della lezione. |
| Verifica | Configurazione che al momento dell'attivazione congela un snapshot delle domande eleggibili e le regole di estrazione; non è un PDF conservato. |
| Istanza digitale | Snapshot della verifica effettivamente assegnato a un tentativo digitale, con le sole informazioni necessarie a svolgimento, correzione ed export didattico. |
| Tentativo | Accesso di uno studente a una verifica per un canale; è associato a una sola coppia nome/cognome normalizzata. |
| Consegna | Risposte inviate in modo definitivo nel canale digitale. |
| Correzione | Punteggi, commenti, percentuale e relative rettifiche. |

**BR-DOM-01.** I riferimenti tecnici devono usare identificatori stabili, non titoli o nomi file. Rinominare un contenuto non può creare riferimenti orfani.

**BR-DOM-02.** Una lezione senza pool è valida e visualizzabile, ma non fornisce domande per la generazione delle verifiche.

**BR-DOM-03.** Il sistema non è un archivio di versioni dei Markdown. File e asset correnti sono la conoscenza corrente; l'export repository restituisce tale stato corrente.

## 5. Repository didattico e programma svolto — Modulo 1

**FR-REP-01.** Il docente deve poter creare e gestire Programmi, importare UDA, lezioni, pool e asset mediante file singoli, cartelle o archivio `.zip` che rispettano `contratto-importazione.md`.

**FR-REP-02.** Il sistema deve mostrare una validazione prima di rendere disponibili i file importati. Un errore in un pool non rende non valida la lezione, ma il pool non è selezionabile finché non viene corretto.

**FR-REP-03.** Il docente deve poter sostituire o eliminare file e cartelle. Prima dell'azione il sistema deve indicare gli elementi interessati e l'effetto sulle verifiche future. Non deve promettere la rigenerazione di verifiche cartacee già inviate.

**FR-REP-04.** Il rendering della lezione deve supportare Markdown e immagini, tema chiaro e scuro, e domande di autoverifica presenti nel file lezione. Non deve renderizzare il file `.pool.md`.

**FR-REP-05.** Il sistema deve produrre un ZIP con i Markdown e gli asset correnti nella struttura importata, senza trasformarli in formato proprietario.

**FR-REP-06.** Il docente deve poter selezionare UDA e lezioni svolte e scaricare un file di testo del programma svolto nell'ordine della struttura didattica.

**FR-REP-07.** Il docente deve disporre di un kit scaricabile con template Programma/UDA/Lezione/Pool e di una dashboard di prontezza che mostra validità strutturale, lezioni senza pool, pool non validi e conteggio delle domande eleggibili. Il kit e la dashboard non generano contenuti né modificano Markdown.

**BR-REP-01.** Il sistema non modifica semanticamente il Markdown importato. Eventuali metadati operativi sono conservati separatamente dai file originali.

**AC-REP-01.** Data una UDA con una lezione valida e un pool non valido, il rendering della lezione funziona e la UI mostra gli errori del pool con file, domanda e campo interessati.

**AC-REP-02.** Dato un repository con asset e cartelle annidate, l'export ZIP mantiene file, nomi e relazioni di percorso leggibili fuori da SchoolForge.

## 6. Contratto Markdown e pool domande v1

### 6.1 UDA e lezione

**BR-MD-00.** La radice di ogni Programma contiene `programma.yaml` conforme a `schoolforge-program/v1`, con `id`, titolo, anno scolastico, ordine delle UDA e ordine delle lezioni. Le lezioni risiedono nella cartella della relativa UDA; il manifesto conferma appartenenza e ordinamento. I nomi file restano leggibili ma non sono identificatori tecnici.

**BR-MD-01.** Il file UDA deve chiamarsi `uda-XX-titolo.md` e dichiarare nel front matter YAML almeno `id`, `titolo`, `competenze` e `obiettivi`. `competenze` e `obiettivi` sono liste di stringhe non vuote. L'`id` coincide con quello del manifesto.

**BR-MD-02.** Una lezione deve chiamarsi `lezione-XXX-titolo.md` e dichiarare nel front matter YAML il proprio `id`, coincidente con il manifesto. Il corpo Markdown è libero; il sistema non richiede un editor né impone una struttura didattica aggiuntiva.

### 6.2 Formato del pool

Ogni pool usa il nome della lezione con suffisso `.pool.md` e contiene solo il seguente front matter YAML. La scelta evita una grammatica Markdown ambigua e mantiene domande, formule e risposte multiriga esprimibili in Markdown mediante blocchi YAML `|`.

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

**BR-POOL-05.** Campi sconosciuti sono rifiutati nella versione v1. Un pool non valido è interamente escluso dalla selezione: il sistema non seleziona parzialmente domande da un file con errori.

**BR-POOL-06.** Il punteggio massimo della domanda è `roundHalfUp(100 × coefficiente_difficolta × coefficiente_peso)` centesimi di punto, con bassa/basso = 0,75, media/medio = 1,00 e alta/alto = 1,25. Backend, API, audit ed export usano interi in centesimi; solo la UI li visualizza con due decimali. La percentuale usa i centesimi e viene arrotondata half-up a due decimali soltanto in visualizzazione/export.

**AC-POOL-01.** Un pool con due `id` uguali, una soluzione chiusa inesistente o un valore di difficoltà non ammesso viene rifiutato indicando la riga o il percorso YAML e la causa.

**AC-POOL-02.** Un pool valido con domanda aperta e domanda chiusa singola diventa selezionabile e non compare nel rendering della lezione.

## 7. Configurazione e selezione delle verifiche — Modulo 2

### 7.1 Configurazione e stati

**FR-VER-01.** Il docente crea una verifica con: titolo, una o più UDA e/o lezioni sorgenti, numero totale di domande, tipi ammessi, difficoltà ammesse e minimo per ciascuna difficoltà scelta, modalità variante e canale o canali abilitati.

**BR-VER-01.** Una verifica percorre gli stati `bozza`, `attiva`, `chiusa`, `archiviata`. Solo la bozza è modificabile. L'attivazione rende immutabili configurazione e `publishedQuestionSnapshot`; la chiusura impedisce nuovi tentativi; l'archiviazione è consentita solo dopo la chiusura e nasconde la verifica dalle normali viste operative senza eliminare consegne o snapshot necessari.

**BR-VER-02.** Non sono richiesti calendario, durata configurabile, cronometro o chiusura automatica nella V1. L'apertura avviene con attivazione manuale e la chiusura con azione esplicita del docente.

**BR-VER-03.** Il sistema blocca l'attivazione se non esistono fonti selezionate, tipi o difficoltà ammessi, se il totale è minore di uno, se la somma dei minimi supera il totale oppure se il pool corrente non contiene abbastanza domande eleggibili e distinte per soddisfare la configurazione.

**BR-VER-04.** Le impostazioni attivate e il `publishedQuestionSnapshot` non cambiano. Lezioni e pool correnti possono evolvere solo per verifiche future; una verifica attiva continua a generare dal proprio snapshot. Non è richiesto ricostruire verifiche archiviate oltre agli snapshot necessari alle consegne digitali e alla configurazione della verifica.

### 7.2 Algoritmo di selezione

**BR-SEL-01.** Il sistema parte dal `publishedQuestionSnapshot`, ordina i candidati per `lessonId`, poi `questionId`, filtra per tipo e difficoltà ammessi, soddisfa i minimi di difficoltà e completa fino al totale usando solo domande ancora non scelte. La stessa domanda non può comparire due volte nella stessa istanza. L'ordine di estrazione è l'ordine di presentazione e viene salvato nello snapshot dell'istanza digitale.

**BR-SEL-02.** Per la modalità `tutte_uguali`, il backend seleziona le domande dal `publishedQuestionSnapshot` all'attivazione e conserva il risultato immutabile. Per `tutte_diverse`, il backend usa il medesimo snapshot e l'algoritmo `schoolforge-selection/v1`: stream pseudo-casuale HMAC-SHA-256 in counter mode con chiave `selectionSecret` in Secret Manager e input `verificationId + U+001F + participantKey + U+001F + counter`; ogni shuffle Fisher-Yates usa interi uniformi ottenuti dallo stream con rejection sampling. Prima seleziona i minimi per difficoltà, poi completa dal restante insieme eleggibile. La modalità produce una variante personalizzata, ma non promette unicità matematica quando il numero di combinazioni possibili è insufficiente.

**BR-SEL-03.** Un `publishedQuestionSnapshot` non conforme blocca l'attivazione; una modifica successiva delle fonti non può rendere non conforme una verifica già attiva. La configurazione non viene mai alterata automaticamente.

### 7.3 PDF e invio al recapito

**FR-VER-02.** Il PDF studente contiene titolo, nome, cognome, email, classe se dichiarata, data del giorno, domande, punteggio massimo e spazio di risposta. Non espone soluzioni o opzioni corrette.

**FR-VER-03.** Il docente può generare e scaricare un PDF in ogni momento. Nome, cognome, email e classe sono vuoti e compilabili a mano; la data non è presente. Questo download non crea tentativi né participant lock.

**FR-VER-04.** Per il canale cartaceo il sistema genera il PDF on-demand e lo invia al recapito dichiarato. Il PDF non è salvato come file persistente prima, durante o dopo l'invio.

**BR-VER-05.** Nome e cognome sono bruciati per la coppia `verifica + participantKey`, indipendentemente dal canale scelto. È una regola di limitazione del tentativo, non una prova di identità e non un controllo anti-frode. L'email non partecipa al lock.

**BR-VER-06.** L'avvio del tentativo deve riservare `participantKey` in modo concorrente-sicuro. L'invio email deve usare una chiave di idempotenza; un errore prima dell'accettazione da parte del servizio email annulla tentativo e lock, mentre un tentativo inviato non può generare un secondo invio accidentale. Un rilascio successivo del lock è possibile solo con azione docente confermata e auditata.

**AC-VER-01.** Una configurazione con totale 8 e minimi 3 bassa, 3 media, 3 alta non può essere attivata.

**AC-VER-02.** Dopo un invio cartaceo riuscito, lo stesso nome/cognome normalizzato non può richiedere né una seconda email né avviare il canale digitale per la stessa verifica, salvo reset esplicito del docente.

**AC-VER-03.** Il download docente non invia email, non persiste PDF e non modifica il registro dei tentativi.

## 8. Portale Verifiche digitale — Modulo 3

### 8.1 Avvio e tentativo

**FR-POR-01.** Il link di una verifica attiva mostra esclusivamente i dati essenziali e la scelta del canale. Per il canale digitale lo studente inserisce nome, cognome, email e classe facoltativa; il sistema comunica chiaramente che nessun dato è verificato e che il tentativo è unico per nome e cognome dichiarati.

**FR-POR-02.** All'avvio digitale il sistema crea un'istanza con le domande effettivamente assegnate, riserva `participantKey` e fornisce un token opaco di ripresa valido solo per lo stesso browser. Il token non deve contenere dati personali, soluzioni o configurazione della verifica.

**BR-POR-01.** Da quando un tentativo digitale è avviato, nome e cognome sono bruciati anche se la consegna non viene completata. Il docente può chiudere la verifica per bloccare nuovi tentativi; i tentativi avviati prima della chiusura possono consegnare finché il docente non li annulla esplicitamente. Reset e rilascio lock richiedono motivazione e conferma esplicita.

### 8.2 Svolgimento, salvataggio e consegna

**FR-POR-03.** Il Portale mostra le domande in sequenza verticale. Ogni domanda espone tipo, difficoltà, peso, punteggio massimo e un controllo di risposta coerente con il tipo. La classe resta facoltativa e non blocca il flusso.

**FR-POR-04.** Le risposte devono essere salvate automaticamente come bozza durante lo svolgimento e dopo ogni modifica significativa. Un refresh o una breve interruzione di rete nello stesso browser deve consentire la ripresa del tentativo senza assegnare nuove domande.

**FR-POR-05.** L'header sticky mostra il nome dichiarato e il comando `Consegna`. Prima della consegna il sistema richiede conferma e segnala le domande senza risposta; lo studente può comunque consegnare se il docente non ha imposto completezza nella configurazione futura.

**BR-POR-02.** Una risposta aperta è testo semplice fino a 10.000 caratteri Unicode. Una risposta chiusa contiene solo identificatori di opzioni presenti nello snapshot: una scelta per `chiusa_singola`, più scelte distinte e ordinate per `chiusa_multipla`. Il backend accetta risposte vuote come bozza e rifiuta ogni payload non coerente con il tipo della domanda.

**BR-POR-03.** La consegna definitiva rende immutabili risposte e domande dell'istanza. Il sistema conserva questa istanza solo per il canale digitale, perché è necessaria alla correzione; ciò non equivale a conservare il PDF del canale cartaceo.

**BR-POR-04.** Il Portale non contiene menu, link esterni, soluzioni, opzioni corrette, risultati, voti o storico dello studente.

### 8.3 Deterrenza realistica

**FR-POR-06.** Il Portale deve richiedere l'ingresso in fullscreen quando il browser lo supporta, mostrare un avviso persistente in caso di uscita dal fullscreen o cambio scheda e disabilitare copia-incolla nella propria UI.

**BR-POR-05.** Fullscreen, rilevamento tab e blocco copia-incolla sono deterrenti, non sicurezza. L'uscita dal tab non annulla il tentativo e gli eventi sono visibili al docente solo come informazione consultiva.

**AC-POR-01.** Uno studente avvia una prova digitale, ricarica la pagina nello stesso browser e ritrova le stesse domande e le risposte salvate.

**AC-POR-02.** Dopo la consegna, il docente può consultare testo domanda, soluzione, risposta, dati dichiarati e timestamp; lo studente non può modificare né rivedere la consegna nel Portale.

**AC-POR-03.** Il docente annulla un tentativo con motivazione e conferma; il token di ripresa diventa inutilizzabile e il lock viene rilasciato solo se il docente ha richiesto esplicitamente la riapertura.

## 9. Correzione manuale e percentuali — Modulo 4

**FR-COR-01.** Il docente può filtrare le consegne digitali per verifica, stato di correzione, recapito, nome dichiarato, classe e data.

**FR-COR-02.** Per ogni consegna il docente visualizza domanda, soluzione, risposta, punteggio massimo e dati dichiarati. Può assegnare a ogni domanda un punteggio da zero al massimo e un commento opzionale.

**FR-COR-03.** Il sistema calcola `somma centesimi assegnati / somma centesimi massimi × 100` e visualizza il risultato con arrotondamento half-up a due decimali. Finché esiste una domanda priva di punteggio definitivo, la percentuale è `non definitiva`.

**BR-COR-01.** SchoolForge non converte percentuali in voti e non scrive nel registro elettronico.

**FR-COR-04.** Il docente può rettificare punteggio o commento. Ogni rettifica registra autore, data, valore precedente, valore nuovo e motivazione obbligatoria; il log è append-only.

**FR-DAT-01.** Il docente deve poter eliminare una consegna digitale quando necessario per la propria gestione dei dati. L'operazione richiede conferma, rimuove dati personali, risposte e correzioni; conserva solo un evento di audit non identificativo con data e motivazione. Non è ammessa per una correzione in corso senza conferma aggiuntiva.

**BR-DAT-01.** La V1 non stabilisce una durata di conservazione automatica. I dati restano disponibili al docente finché non vengono eliminati con la funzione prevista o secondo le procedure dell'ambiente di esercizio; la responsabilità della politica di conservazione rimane del docente/committente.

### 9.1 Esportazione globale delle verifiche svolte

**FR-EXP-01.** Il docente deve disporre del comando `Esporta verifiche`, che genera un unico documento scaricabile contenente tutte le consegne digitali definitive non annullate e non eliminate presenti nel sistema. L'operazione non è limitata a una singola verifica o a un singolo studente.

**FR-EXP-02.** L'export deve essere costruito dall'istanza digitale associata a ciascuna consegna, cioè dallo snapshot delle domande effettivamente assegnate, e non dal Markdown o dal pool corrente. La modifica o l'eliminazione successiva di una lezione non può rendere incompleta una consegna già esportabile.

**BR-EXP-01.** Per ogni consegna esportata, il documento include almeno: titolo della verifica, identificativo del tentativo, data e ora di consegna, nome, cognome, email e classe se presenti; per ogni domanda, testo, tipo, difficoltà, peso, punteggio massimo e risposta dello studente; punteggio assegnato, commento, punteggio totale e percentuale quando disponibili.

**BR-EXP-02.** Le consegne nell'export sono ordinate per verifica e, al suo interno, per data di consegna. Le consegne annullate, eliminate o ancora in bozza non vengono incluse.

**BR-EXP-03.** Il contenuto dell'export è vincolante; il renderer potrà produrre un PDF unico, un documento Markdown o un altro formato standard deciso successivamente. Il formato non deve modificare dati, ordine o completezza dell'export.

**BR-EXP-04.** L'export è generato on-demand per il download del docente e non viene conservato dal sistema. È destinato anche al caricamento manuale nel Drive dell'istituto; SchoolForge non richiede né implementa un'integrazione con Google Drive.

**AC-EXP-01.** Date consegne definitive di verifiche diverse, una consegna annullata e una bozza non consegnata, quando il docente esegue `Esporta verifiche`, allora il documento contiene tutte e sole le consegne definitive, ordinate per verifica e data.

**AC-EXP-02.** Dopo la modifica del Markdown sorgente, l'export di una consegna digitale già effettuata mostra ancora le stesse domande e risposte dell'istanza svolta.

**AC-COR-01.** Dopo l'attribuzione dei punteggi a tutte le domande, la percentuale visualizzata corrisponde alla formula e usa due decimali.

**AC-COR-02.** Una rettifica conserva valori, autore, data e motivazione e ricalcola la percentuale senza sovrascrivere la storia.

## 10. Correzione assistita AI — Modulo 5

La generazione AI delle domande non fa parte di SchoolForge. L'unico uso AI previsto è la correzione di consegne digitali già disponibili.

**FR-AI-01.** In modalità assistita, l'AI può proporre punteggio, motivazione, commento e spiegazione degli errori per ogni risposta. Il docente può approvare, modificare o rifiutare una proposta singolarmente o in blocco.

**FR-AI-02.** In modalità automatica, l'AI può rendere definitiva una proposta soltanto quando il docente ha attivato esplicitamente tale modalità per la specifica verifica. Ogni esito resta modificabile e marcato come `automatico`.

**FR-AI-03.** Il docente può fornire una nota testuale di correzione per la specifica verifica. La nota è inviata all'AI solo per le correzioni alle quali è associata.

**BR-AI-01.** Il contesto AI è limitato a lezione sorgente corrente, domanda dell'istanza, soluzione, risposta dello studente e nota del docente. Web, browsing, retrieval esterno, fonti non selezionate e generazione di nuove domande sono vietati.

**BR-AI-02.** La modalità predefinita è assistita. L'AI non può attivare verifiche, modificare Markdown, inviare email, eliminare dati o annullare consegne.

**BR-AI-03.** Se manca uno degli elementi necessari al contesto, l'item non è inviato all'AI e richiede correzione manuale.

**FR-AI-04.** Il rapporto di anomalie stilistiche è esclusivamente consultivo per il docente: non modifica punteggi, non blocca né penalizza. Se non esiste un corpus di consegne digitali precedenti sufficiente a un confronto, il sistema deve dichiarare `riferimenti insufficienti` e non produrre inferenze sullo studente.

**NFR-AI-01.** Per ogni elaborazione AI il sistema deve registrare finalità, docente, verifica, item coinvolti, provider/modello configurati, versione delle istruzioni, timestamp, esito, proposta e azione umana successiva. Non deve registrare nei log tecnici ulteriori copie delle risposte.

**AC-AI-01.** Una proposta AI non approvata non altera punteggi o percentuale. Un'approvazione massiva applica solo gli item completi e registra gli item inclusi.

## 11. Requisiti trasversali

### 11.1 Integrità e sicurezza

**NFR-SEC-01.** Tutti i dati personali, risposte, punteggi, contenuti privati e credenziali devono essere protetti in transito e a riposo. Segreti e token non devono comparire in Markdown, export del repository, messaggi utente o telemetria.

**NFR-SEC-02.** Il Portale deve limitare tentativi ripetuti e richieste abusive sul link della verifica senza trasformare nome, cognome o email in un sistema di autenticazione. Il controllo usa finestre temporali, token della verifica e impronta IP pseudonimizzata; deve rifiutare prima di invio email, generazione PDF o scrittura di snapshot.

**NFR-SEC-03.** Le operazioni del docente che eliminano dati, attivano o chiudono una verifica, annullano un tentativo o abilitano la correzione automatica richiedono conferma esplicita e indicano la conseguenza.

**NFR-INT-01.** Devono essere tracciati almeno importazione, validazione, sostituzione, eliminazione, configurazione, attivazione, chiusura, avvio tentativo, invio email, consegna, correzione, rettifica, annullamento e operazioni AI.

**NFR-INT-02.** I log di audit non sono modificabili dalla UI ordinaria. Devono indicare autore o servizio, oggetto, momento, azione ed esito; non devono contenere la risposta completa dello studente salvo necessità funzionale separata.

**NFR-INT-03.** L'ambiente di produzione usa Firebase con Cloud Firestore, Cloud Storage e runtime backend configurati nella regione Milano `europe-west8` ove il servizio lo supporta. Firebase Hosting e Firebase Authentication non devono essere descritti come garanzia di elaborazione esclusivamente italiana.

**NFR-INT-04.** Firestore e i contenuti Markdown/asset in Cloud Storage devono essere inclusi in un backup giornaliero con conservazione minima di 30 giorni. L'RPO è 24 ore; l'RTO è best-effort, senza tempo massimo contrattuale. Il Docente responsabile esegue o fa eseguire una verifica periodica di ripristino.

### 11.2 Dati e portabilità

**NFR-DAT-01.** Il sistema raccoglie nel Portale soltanto nome, cognome, email, classe facoltativa e le risposte necessarie ai canali scelti. L'email è usata per l'invio cartaceo e non come identificatore tecnico del tentativo. Nessun dato ulteriore è richiesto nel canale cartaceo oltre ai campi di intestazione dichiarati.

**NFR-DAT-02.** I dati operativi devono essere esportabili dall'ambiente di esercizio in formati standard. L'export tecnico comprende configurazioni, registro dei tentativi, consegne digitali, correzioni e audit secondo i permessi del docente/committente; `Esporta verifiche` è l'export didattico globale, leggibile e destinato al docente.

**NFR-DAT-03.** L'applicazione non certifica la base giuridica del trattamento né sostituisce gli adempimenti del docente o dell'istituto. Deve però rendere visibili i dati inviati ai servizi esterni e consentire al docente di non usare l'AI.

### 11.3 Esperienza, accessibilità e operatività

**NFR-UX-01.** Entrambe le applicazioni devono essere responsive; il pannello docente è desktop-first e il Portale è mobile-first. Stati, errori e blocchi devono indicare causa ed azione correttiva.

**NFR-ACC-01.** Il target di implementazione è WCAG 2.2 livello AA per struttura semantica, tastiera, focus, contrasto, alternative testuali e messaggi di errore. Le misure di deterrenza non devono rendere impossibile lo svolgimento con tecnologie assistive.

**NFR-OPS-01.** Devono essere osservabili errori di importazione, rendering, invio email, generazione PDF, consegna e AI, senza inviare contenuti o dati personali non necessari alla telemetria.

**NFR-COST-01.** L'architettura deve privilegiare servizi managed e scale-to-zero, riusare le quote incluse Firebase e rifiutare componenti sempre attivi, enterprise o a pagamento non necessari ai requisiti. Prima del go-live il Docente deve configurare budget e avvisi di spesa nel progetto Firebase; il valore della soglia è una scelta operativa del Docente.

## 12. Roadmap e dipendenze

| Modulo | Capacità rilasciata | Dipendenze | Uscita verificabile |
|---|---|---|---|
| 1. Repository didattico | Programmi, UDA, lezioni, pool, rendering, ZIP, programma svolto. | Accesso docente e validatore pool. | Funziona senza Portale, AI o correzione. |
| 2. Verifiche e cartaceo | Configurazione, snapshot pubblicato, selezione da pool, PDF e invio email, download docente. | Modulo 1 e servizio email. | Vincoli validati, PDF non archiviato, nome/cognome bloccati dopo invio. |
| 3. Portale digitale | Istanza, bozza, ripresa, consegna e deterrenza. | Modulo 2. | Una consegna strutturata è consultabile dal docente. |
| 4. Correzione manuale ed export | Punteggi, percentuale, rettifiche, eliminazione consegna ed export globale delle verifiche svolte. | Modulo 3. | Percentuali, audit ed export da snapshot verificabili. |
| 5. Correzione AI | Proposte, approvazioni, opt-in automatico e rapporto consultivo. | Modulo 4, C-02 e C-03. | I flussi manuali restano operativi senza AI. |

**BR-REL-01.** Nessun modulo successivo può diventare prerequisito del precedente. L'assenza dell'AI non deve bloccare repository, PDF, email, Portale digitale o correzione manuale.

## 13. Decisioni di esercizio

### 13.1 C-01 formalizzata

| Voce | Decisione |
|---|---|
| Provider | Firebase, su progetto di proprietà del Docente. |
| Regione dati | Milano `europe-west8`, ove supportata dal servizio Firebase/Google Cloud interessato. |
| Backup | Giornaliero per Firestore e Cloud Storage, con conservazione minima di 30 giorni. |
| RPO | 24 ore. |
| RTO | Best-effort, senza target contrattuale numerico. |
| Responsabile operativo | Docente proprietario del progetto e delle procedure di verifica/ripristino. |

### 13.2 Decisioni residue

| ID | Decisione | Owner | Scadenza | Effetto se assente |
|---|---|---|---|---|
| C-02 | Provider AI, condizioni contrattuali, residenza dati e condizioni per l'invio delle risposte. | Docente / committente. | Prima del Modulo 5. | Modulo 5 disabilitato; gli altri moduli restano validi. |
| C-03 | Regola didattica per la correzione automatica e necessità di revisione umana. | Docente. | Prima di abilitare la modalità automatica. | Rimane disponibile solo la modalità assistita. |

Ogni decisione deve generare un breve verbale nel repository con data, responsabile, opzioni valutate, scelta e vincoli applicativi. Non è un requisito accettabile sostituire una decisione mancante con una scelta tecnica silenziosa.

## 14. Criteri globali di accettazione

La futura architettura e l'implementazione sono conformi solo se dimostrano con test e flussi completi che:

1. Markdown e asset restano esportabili e leggibili senza SchoolForge;
2. un pool invalido non compromette la lezione ma non può generare domande;
3. la configurazione attivata è immutabile e la modifica di una lezione non pretende di ricreare PDF già inviati;
4. l'email è un recapito non verificato; nome e cognome normalizzati vengono bloccati in modo concorrente-sicuro tra i due canali;
5. il PDF cartaceo viene inviato senza essere archiviato e il download docente non altera il tentativo;
6. un tentativo digitale riprende nello stesso browser con le stesse domande e diventa immutabile alla consegna;
7. soluzioni e opzioni corrette non sono mai esposte al Portale;
8. percentuali e rettifiche sono calcolabili e tracciabili senza gestire voti;
9. l'AI non genera domande, non usa il web, non è necessaria ai flussi manuali e resta sotto controllo del docente;
10. il comando `Esporta verifiche` include tutte e sole le consegne digitali definitive e usa gli snapshot svolti, non le lezioni correnti;
11. C-01 è applicata nel progetto Firebase di produzione; C-02 e C-03 bloccano soltanto le funzionalità AI a cui si riferiscono.

---

## Appendice A — Stato della baseline

Questa analisi sostituisce le versioni precedenti. Architettura, piano, contratti, sicurezza, test, glossario, diagrammi, README e guida agente sono allineati alla baseline v3.2. Il gate G0 richiede una review documentale senza conflitti prima di F-01.
