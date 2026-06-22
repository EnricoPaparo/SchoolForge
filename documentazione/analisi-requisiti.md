# SchoolForge — Analisi dei requisiti

**Versione:** 1.0  
**Data:** 22 giugno 2026  
**Stato:** baseline di requisiti per la progettazione architetturale  
**Destinatario successivo:** Solution / Software Architect

---

## 1. Scopo, autorità e convenzioni

Questo documento traduce il *Project Concept Brief* in requisiti di prodotto, regole operative, vincoli e criteri di accettazione verificabili. È l'input funzionale per la progettazione architetturale; non prescrive framework, database, provider AI, provider di identità o tecnologia di deployment.

Le decisioni esplicite del brief sono vincolanti. Le specifiche contrassegnate **[D]** sono requisiti derivati: rendono operativa un'intenzione esplicita del brief senza cambiarne il perimetro. Devono essere trattate come baseline, salvo modifica approvata dal committente. Le voci **[C]** sono configurazioni o decisioni di esercizio che non possono essere dedotte correttamente dal brief e devono essere definite prima del relativo rilascio; non devono essere sostituite da assunzioni tecniche nascoste.

| Prefisso | Significato |
|---|---|
| FR | Requisito funzionale |
| BR | Regola di business vincolante |
| NFR | Requisito non funzionale |
| AC | Criterio di accettazione |
| D | Specificazione derivata dall'analisi |
| C | Decisione/configurazione da confermare |

In caso di conflitto prevalgono, nell'ordine: obblighi di legge applicabili, decisioni esplicite del brief, questo documento, scelte architetturali. Nessuna scelta architetturale può ampliare lo scope o attenuare un requisito qui definito senza approvazione del committente.

## 2. Sintesi esecutiva

SchoolForge è un repository didattico personale, **Markdown-first** e **knowledge-first**, per un solo docente. La lezione Markdown è la fonte canonica della conoscenza. Da una selezione esplicita di lezioni e UDA il sistema deve rendere la lezione, comporre verifiche, produrre soluzioni e rubriche, esportare prove, acquisire e storicizzare esiti e, in una fase successiva, assistere la correzione con AI.

Non è un LMS, un registro elettronico né un portale studenti. Gli studenti non hanno un account SchoolForge e svolgono le prove su canali esterni, con Google Forms come canale digitale prioritario. L'AI è facoltativa, disattivabile e non può usare navigazione o recupero di fonti web: ogni suo output deve dipendere esclusivamente dal corpus didattico selezionato e da dati espressamente autorizzati per lo specifico compito.

Il prodotto deve crescere per moduli indipendenti: il Repository Didattico deve produrre valore senza AI, senza Google Forms e senza gli altri moduli.

## 3. Obiettivi e misure di esito

### 3.1 Obiettivi di prodotto

1. Centralizzare la conoscenza didattica in file Markdown portabili e indipendenti dalla piattaforma.
2. Rendere la conoscenza ricercabile, navigabile e visualizzabile senza modificare i file nel sistema.
3. Generare e mantenere prove coerenti, tracciabili e riproducibili rispetto alle fonti selezionate.
4. Conservare uno storico affidabile di prove, consegne, correzioni e voti.
5. Ridurre il lavoro operativo del docente senza trasferire all'AI la governance del processo o la proprietà della conoscenza.

### 3.2 Misure di esito da definire per il go-live [C]

Il brief non contiene baseline quantitative. Prima del rilascio operativo il committente deve definire: volume atteso di lezioni e allegati, numero massimo di studenti/classi gestiti, frequenza delle verifiche, tempi massimi accettabili per importazione/rendering/generazione/esportazione, disponibilità richiesta e periodo di conservazione dei dati. L'architettura deve rendere tali parametri osservabili e configurabili dove pertinente; non deve inventare limiti di capacità non approvati.

## 4. Perimetro

### 4.1 Incluso

| Area | Funzione inclusa |
|---|---|
| Repository | Gestione di programmi, UDA, lezioni Markdown e relativi asset |
| Fruizione | Rendering delle lezioni con immagini, tema chiaro/scuro, autoverifica visibile e domande di verifica nascoste |
| Verifiche | Composizione da domande archiviate e, se attivata, generazione AI vincolata al corpus selezionato |
| Output | Soluzioni, rubriche, PDF e integrazione Google Forms |
| Anagrafica | Classi, studenti, email e assegnazioni di prove |
| Archivio | Prove, versioni, consegne, risposte, commenti, punteggi, voti e PDF archiviabili |
| AI successiva | Correzione assistita e, se espressamente abilitata, automatica |

### 4.2 Escluso

Sono espressamente fuori scope: registro elettronico, presenze, compiti, forum, chat, videolezioni, social learning, LMS completo, portale o account SchoolForge per studenti, gestione multi-docente/multi-istituto/organizzazioni, editor Markdown integrato, analytics didattiche e profilo studente AI. La conoscenza proveniente dal web non è una fonte didattica primaria né una fonte consentita per la generazione AI.

Non è inoltre incluso un meccanismo di sincronizzazione continua con cartelle locali, Drive o altri repository: la V1 acquisisce contenuti esclusivamente tramite operazioni esplicite di caricamento, sostituzione ed eliminazione eseguite dal docente.

## 5. Utenti, ruoli e autorizzazioni

| Ruolo | Descrizione | Permessi |
|---|---|---|
| Docente proprietario | Unico utente applicativo della V1 | Accesso completo a contenuti, anagrafiche, configurazioni, output, archivi e azioni AI |
| Studente | Soggetto dell'archivio, non utente applicativo | Nessun accesso a SchoolForge; può usare soltanto il canale esterno predisposto dal docente |
| Servizio esterno | Google Forms e, se configurato, provider AI | Accesso strettamente limitato allo scopo della singola integrazione |

**FR-AUTH-01.** Il sistema deve richiedere l'autenticazione del Docente proprietario prima di mostrare o modificare dati didattici o personali.  
**FR-AUTH-02.** La V1 deve esporre un solo ruolo applicativo: Docente proprietario. Non deve introdurre ruoli organizzativi, condivisione tra docenti o deleghe.  
**BR-AUTH-01.** Gli studenti non devono poter autenticarsi, leggere i contenuti del repository, consultare soluzioni/rubriche o accedere allo storico in SchoolForge.  
**NFR-AUTH-01.** L'architettura di identità deve essere sostituibile senza modificare il modello didattico o gli archivi.

## 6. Glossario e modello di dominio

| Entità | Definizione e relazioni essenziali |
|---|---|
| Programma | Materia o percorso didattico del docente. Contiene una o più UDA. |
| UDA | Unità organizzativa principale. Appartiene a un Programma e contiene una o più Lezioni. |
| Lezione | Documento Markdown canonico con asset associati e metadati. Appartiene a una sola UDA nella V1. |
| Revisione lezione | Snapshot immutabile di una Lezione acquisito dal sistema; è identificato da contenuto, data e impronta. |
| Domanda archiviata | Domanda strutturata presente in una Lezione e idonea alla selezione per una verifica. |
| Domanda generata | Proposta prodotta da AI dal corpus autorizzato; diventa utilizzabile solo dopo approvazione del docente. |
| Verifica | Definizione logica della prova: fonti, configurazione, domande approvate, soluzione e rubrica. |
| Versione di verifica | Variante immutabile e identificata della Verifica destinata a uno o più studenti. |
| Assegnazione | Legame tra una Versione di verifica, destinatari, canale di erogazione e relativo stato. |
| Consegna | Insieme di risposte di uno studente per un'assegnazione/versione. |
| Correzione | Punteggi, commenti, motivazioni, approvazioni e voto finale associati a una Consegna. |
| Artefatto archiviabile | File PDF o altra rappresentazione prodotta e collegata in modo immutabile a una specifica versione o consegna. |

### 6.1 Relazioni obbligatorie

```text
Programma 1 ──< UDA 1 ──< Lezione 1 ──< Revisione lezione
                                   └──< Domanda archiviata

Verifica >── 1..n revisioni di lezione selezionate
Verifica 1 ──< Versione di verifica 1 ──< Assegnazione 1 ──< Consegna 1 ──1 Correzione
Classe 1 ──< Studente
```

**BR-DOM-01.** Ogni identificatore di dominio deve essere stabile e non dipendere da titolo, nome file o posizione di una cartella.  
**BR-DOM-02.** Una Verifica e ogni sua Versione devono dichiarare in modo risalibile le revisioni di lezione dalle quali derivano.  
**BR-DOM-03.** Un nome, un titolo o una UDA possono cambiare, ma non devono invalidare collegamenti storici, artefatti o correzioni già archiviati.

## 7. Principi e vincoli architetturalmente rilevanti

**BR-CORE-01 — Markdown-first.** La conoscenza didattica deve esistere in file Markdown standard, leggibili al di fuori di SchoolForge e esportabili con i relativi asset. Il database, se presente, è un indice e un archivio di dati derivati/operativi; non è l'unica sede del contenuto didattico.

**BR-CORE-02 — Fonte unica.** Il contenuto della Lezione, le domande archiviate, gli obiettivi e gli asset associati costituiscono il corpus didattico. Presentazioni, verifiche, soluzioni, rubriche e analisi devono dichiarare la provenienza da tale corpus.

**BR-CORE-03 — Knowledge-first.** In caso di conflitto tra una funzione accessoria e conservazione, portabilità, integrità o tracciabilità della conoscenza, deve prevalere la conoscenza.

**BR-CORE-04 — AI optional.** Tutte le funzioni dei Moduli 1 e 3 devono restare utilizzabili con AI non configurata o non disponibile. L'assenza di AI deve produrre messaggi espliciti e percorsi manuali, non errori bloccanti estranei alla funzione richiesta.

**BR-CORE-05 — Evoluzione incrementale.** Ogni modulo rilasciato deve essere eseguibile e verificabile senza dipendere dai moduli successivi. Nessun requisito del Modulo 1 può richiedere Google Forms, un provider AI o dati di archivio.

## 8. Contratto Lesson Markdown v1 [D]

Il formato segue Markdown CommonMark con YAML front matter. Le estensioni SchoolForge sono limitate al front matter e a blocchi di codice recintati; un file resta quindi leggibile e conservabile come normale Markdown anche senza l'applicazione.

### 8.1 Front matter obbligatorio

```yaml
---
schoolforge: 1
id: "lesson-tpsit-3-01"
title: "Introduzione alle reti"
program_id: "tpsit-3"
uda_id: "tpsit-3-uda-1"
objectives:
  - "Descrivere il modello client-server"
  - "Distinguere LAN e WAN"
---
```

| Campo | Regola |
|---|---|
| `schoolforge` | Obbligatorio; valore esatto `1`. |
| `id` | Obbligatorio; univoco nel repository; non riutilizzabile dopo eliminazione. |
| `title` | Obbligatorio; testo non vuoto. |
| `program_id` | Obbligatorio; deve identificare un Programma esistente o incluso nella stessa importazione atomica. |
| `uda_id` | Obbligatorio; deve identificare una UDA esistente, appartenente al `program_id`, o inclusa nella stessa importazione atomica. |
| `objectives` | Obbligatorio; lista non vuota di obiettivi didattici testuali. |

Programmi e UDA possono essere creati dal sistema prima dell'importazione o tramite un manifesto di importazione a livello di cartella. Il documento di lezione non contiene dati personali né segreti.

### 8.2 Corpo e sezioni

Il corpo Markdown deve usare queste intestazioni di livello 2, ciascuna al massimo una volta e nell'ordine indicato quando presente:

1. `## Contenuto`
2. `## Autoverifica`
3. `## Domande di verifica`

`## Contenuto` è obbligatoria. Può contenere testo, tabelle, codice, immagini e normali costrutti Markdown. Gli URL di immagini devono essere relativi alla cartella della lezione o assoluti HTTPS; il sistema deve impedire il rendering di contenuti eseguibili incorporati.

Le domande devono essere espresse in blocchi `schoolforge-question` YAML. Esempio:

````markdown
```schoolforge-question
id: "q-lan-wan-01"
kind: "self_check"
type: "open"
prompt: "Spiega la differenza tra LAN e WAN."
expected_answer: "..."
```

```schoolforge-question
id: "q-lan-wan-02"
kind: "assessment"
type: "closed_single"
difficulty: "base"
prompt: "Quale rete copre normalmente un edificio?"
options:
  - id: "a"
    text: "LAN"
  - id: "b"
    text: "WAN"
correct_option_ids: ["a"]
solution: "Una LAN copre un'area locale."
rubric:
  max_score: 1
  criteria:
    - id: "correctness"
      description: "Selezione della risposta corretta"
      max_score: 1
```
````

### 8.3 Regole per le domande

| Campo | Regola |
|---|---|
| `id` | Obbligatorio; univoco nella Lezione e stabile tra revisioni se la domanda rappresenta lo stesso item. |
| `kind` | Obbligatorio: `self_check` oppure `assessment`. |
| `type` | Obbligatorio: `open`, `closed_single` o `closed_multiple`. |
| `prompt` | Obbligatorio; testo non vuoto. |
| `difficulty` | Obbligatorio per `assessment`: `base`, `intermedia`, `avanzata`. Facoltativo per `self_check`. |
| `options` e `correct_option_ids` | Obbligatori per tipi chiusi; ogni opzione deve avere id e testo, la risposta corretta deve riferirsi a opzioni esistenti. |
| `expected_answer` | Obbligatorio per `self_check`; facoltativo per domande `assessment` aperte. |
| `solution` e `rubric` | Possono mancare nella Lezione, ma devono essere disponibili nella Verifica prima della pubblicazione. |
| `rubric.max_score` | Numero positivo; la somma dei `criteria.max_score` deve coincidere con esso. |

**BR-MD-01.** Il rendering della lezione deve mostrare il contenuto, gli obiettivi e le sole domande `self_check`; non deve mostrare, indicizzare pubblicamente o esporre nelle pagine di fruizione blocchi `assessment`, soluzioni, opzioni corrette o rubriche.  
**BR-MD-02.** Il parser deve segnalare con file, riga e motivo ogni violazione del contratto. Non deve modificare automaticamente il file sorgente.  
**BR-MD-03.** Il contenuto non conforme resta in stato `Non valido` e non può diventare fonte di nuove verifiche, ma l'ultima revisione valida rimane consultabile e riusabile per gli artefatti storici.  
**BR-MD-04.** Il sistema deve conservare ed esportare i Markdown originali e gli asset senza convertirli nel solo formato proprietario dell'applicazione.

## 9. Gestione repository didattico — Modulo 1

### 9.1 Programmi e UDA

**FR-REP-01.** Il docente deve poter creare, rinominare, riordinare e disattivare Programmi e UDA.  
**FR-REP-02.** Il docente deve poter associare ogni UDA a un solo Programma e visualizzare le Lezioni ordinate per UDA.  
**BR-REP-01.** Non è consentita l'eliminazione fisica di Programmi o UDA che hanno Lezioni, revisioni, verifiche o archivi collegati. L'operazione deve essere una disattivazione che ne preserva l'identificativo e lo storico.  
**BR-REP-02.** Una UDA senza Lezioni è ammessa; un Programma senza UDA è ammesso durante la preparazione del repository.

### 9.2 Acquisizione, sostituzione ed eliminazione

**FR-REP-03.** Il sistema deve consentire il caricamento di un singolo file Markdown con gli asset referenziati.  
**FR-REP-04.** Il sistema deve consentire il caricamento di una cartella, incluse le sottocartelle e gli asset. La cartella deve essere analizzata integralmente prima della conferma.  
**FR-REP-05.** Prima della conferma il sistema deve mostrare un resoconto di importazione: file validi, file non validi, identificatori duplicati, asset mancanti, Programmi/UDA coinvolti e azione proposta per ciascun conflitto.  
**FR-REP-06.** Il docente deve poter sostituire una Lezione mediante un nuovo file Markdown avente lo stesso `id`. La sostituzione deve creare una nuova Revisione lezione e non sovrascrivere gli snapshot già riferiti da verifiche o archivi.  
**FR-REP-07.** Il docente deve poter eliminare una Lezione non referenziata. Per una Lezione referenziata il sistema deve eseguire una disattivazione logica, preservando le revisioni necessarie per riprodurre prove e archivi storici.  
**FR-REP-08.** Il docente deve poter scaricare il file Markdown originale e gli asset di una Lezione; deve poter esportare l'intero repository in una struttura di cartelle portabile.  
**BR-REP-03.** Una importazione a cartella è atomica: se contiene errori bloccanti, nessuna delle modifiche proposte deve essere applicata finché il docente non seleziona esplicitamente le sole unità valide oppure corregge il set di file.  
**BR-REP-04.** La sostituzione di un file con `id` differente non è una revisione: è una nuova Lezione e richiede conferma esplicita se il nome file o la posizione fanno supporre una sostituzione.

### 9.3 Consultazione

**FR-REP-09.** Il docente deve poter navigare Programma → UDA → Lezione, cercare per titolo/obiettivo/testo e filtrare per stato di validazione.  
**FR-REP-10.** Il sistema deve renderizzare le Lezioni in tema chiaro e scuro, mantenendo supporto per immagini e contenuti Markdown consentiti.  
**NFR-REP-01.** Il rendering deve sanificare HTML e URL, impedendo esecuzione di script, iframe non autorizzati e accesso a risorse locali del dispositivo.

### 9.4 Criteri di accettazione del Modulo 1

**AC-REP-01.** Dato un set valido di lezioni con immagini relative, quando il docente lo importa, allora le Lezioni sono visibili nell'UDA dichiarata, le immagini sono renderizzate e i file originali sono scaricabili.  
**AC-REP-02.** Data una Lezione con una domanda `assessment`, quando è aperta in modalità di fruizione, allora il prompt della domanda, la soluzione e la rubrica non sono visibili.  
**AC-REP-03.** Data una Lezione usata da una Versione pubblicata, quando viene sostituita, allora la nuova revisione è disponibile per usi futuri e la Versione precedente mantiene la propria fonte immutata.  
**AC-REP-04.** Dato un Markdown non valido, quando viene importato, allora il sistema indica il motivo e la riga, non altera il sorgente e non lo rende selezionabile per generare una nuova prova.

## 10. Generazione e gestione delle verifiche — Modulo 2

### 10.1 Selezione del corpus

**FR-VER-01.** Il docente deve poter avviare una nuova Verifica selezionando una o più UDA, una o più Lezioni, oppure entrambe. La selezione di una UDA include le revisioni correnti valide delle sue Lezioni; una Lezione selezionata direttamente viene inclusa una sola volta.  
**FR-VER-02.** Prima della generazione, il sistema deve mostrare l'elenco definitivo delle revisioni di lezione incluse e consentire al docente di rimuoverne singoli elementi.  
**BR-VER-01.** Non è consentito generare una Verifica senza almeno una Revisione lezione valida e selezionata.

### 10.2 Configurazione e composizione

**FR-VER-03.** Il docente deve definire numero totale di domande, numero di domande aperte, numero di domande chiuse, difficoltà e numero di versioni.  
**BR-VER-02.** `numero totale = domande aperte + domande chiuse`; tutti i valori sono interi maggiori di zero, salvo uno tra aperte e chiuse che può essere zero. Il numero di versioni è almeno uno.  
**BR-VER-03.** La difficoltà ammessa è `base`, `intermedia`, `avanzata` oppure `mista`. Per difficoltà `mista`, il docente deve definire esplicitamente la distribuzione per livello prima della composizione.  
**FR-VER-04.** Il sistema deve raccogliere dal corpus le Domande archiviate compatibili con tipo e difficoltà richiesti, mostrando per ciascuna la Lezione di origine e la revisione.  
**FR-VER-05.** Se l'AI è configurata e abilitata dal docente per la Verifica, il sistema deve poter proporre Domande generate per colmare o sostituire domande archiviate.  
**BR-VER-04.** Se le domande disponibili non soddisfano la configurazione e l'AI non è utilizzabile, il sistema deve bloccare la composizione indicando il fabbisogno non coperto; non deve ridurre silenziosamente il numero di domande né usare fonti non selezionate.  
**BR-VER-05.** Una Domanda generata non può essere inclusa in una Versione finché il docente non l'ha esaminata e approvata esplicitamente.  
**FR-VER-06.** Il docente deve poter modificare, rimuovere, riordinare e approvare le domande proposte prima del congelamento della Verifica. Per ogni domanda la UI deve mostrare origine, tipo, difficoltà e fonte/revisione.

### 10.3 Versioni, soluzioni e rubriche

**FR-VER-07.** Il sistema deve produrre il numero richiesto di Versioni di verifica, ognuna identificata univocamente e composta in modo coerente con la configurazione approvata.  
**BR-VER-06.** Nessuna Versione può contenere la stessa domanda due volte. Versioni diverse possono condividere domande solo se il docente lo conferma; l'impostazione predefinita deve massimizzare la differenziazione compatibilmente con il corpus disponibile.  
**FR-VER-08.** Per ogni Versione il sistema deve produrre o associare una soluzione completa e una rubrica di correzione per tutte le domande. Possono provenire dalle Lezioni o, se abilitato, dall'AI sul medesimo corpus.  
**BR-VER-07.** Prima della pubblicazione ogni domanda deve avere: prompt, tipo, punteggio massimo positivo, soluzione/chiave di risposta e rubriche complete per le risposte aperte. L'omissione deve bloccare la pubblicazione.  
**FR-VER-09.** Il docente deve poter correggere manualmente soluzioni, rubriche e punteggi massimi prima della pubblicazione. Le modifiche devono essere attribuite al docente e registrate nella Verifica.  
**BR-VER-08.** Una Versione pubblicata è immutabile. Correzioni successive richiedono una nuova Versione oppure un emendamento esplicito, datato e motivato, che preservi sempre il contenuto originario e la sua storia.

### 10.4 Stati della Verifica

| Stato | Significato | Transizioni consentite |
|---|---|---|
| `bozza` | Fonti/configurazione in lavorazione | `in_revisione`, `annullata` |
| `in_revisione` | Domande, soluzioni e rubriche sono sottoposte al docente | `bozza`, `pronta`, `annullata` |
| `pronta` | Completa e validata, non ancora pubblicata/assegnata | `pubblicata`, `bozza`, `annullata` |
| `pubblicata` | Una o più versioni sono disponibili per l'erogazione | `chiusa` |
| `chiusa` | Non accetta nuove consegne nel canale gestito; resta archiviabile | nessuna, salvo emendamento tracciato |
| `annullata` | Non utilizzabile per nuove assegnazioni | nessuna |

**BR-VER-09.** Soltanto una Verifica `pronta` può essere pubblicata. Soltanto una Verifica `pubblicata` può avere nuove Assegnazioni.  
**BR-VER-10.** L'annullamento non elimina Versioni, esportazioni, assegnazioni o consegne già esistenti; deve registrarne motivo e data.

### 10.5 Criteri di accettazione del Modulo 2

**AC-VER-01.** Date due UDA e una Lezione esplicitamente selezionata, quando una Lezione appartiene già a una delle UDA, allora è presente una sola volta nel corpus dichiarato.  
**AC-VER-02.** Data una configurazione di 10 domande, 4 aperte e 5 chiuse, quando il docente tenta la composizione, allora il sistema la rifiuta spiegando la violazione della somma.  
**AC-VER-03.** Dato un corpus con 3 domande chiuse ma una richiesta di 5 e AI disattivata, quando il docente avvia la generazione, allora riceve un blocco esplicito e nessuna domanda esterna viene aggiunta.  
**AC-VER-04.** Data una Versione pubblicata, quando la Lezione di origine viene modificata o eliminata, allora il PDF e il registro delle fonti della Versione restano riproducibili dalla revisione congelata.

## 11. AI: confini, provenienza e controlli

**FR-AI-01.** Il docente deve poter scegliere se usare AI per la generazione di domande, soluzioni/rubriche o correzione, per singola azione e senza obbligo di attivazione globale.  
**BR-AI-01.** Per generare una verifica, il contesto inviato all'AI deve contenere esclusivamente le revisioni delle Lezioni selezionate, le istruzioni applicative e le configurazioni della verifica. Non è consentito includere altre lezioni, basi documentali non selezionate, risultati di ricerca, browser, tool di retrieval web o fonti Internet.  
**BR-AI-02.** L'output AI deve dichiarare le Lezioni/revisioni utilizzate e, per ogni domanda, soluzione o proposta di correzione, deve essere conservata una traccia di provenienza sufficiente a ricostruire il corpus e la configurazione usati.  
**BR-AI-03.** Il sistema non deve rappresentare come supportata dal corpus un'affermazione priva di riferimento alle fonti selezionate. Gli output senza provenienza verificabile devono essere marcati non approvabili.  
**BR-AI-04.** L'AI non ha potere di pubblicazione, assegnazione, cancellazione o modifica irreversibile di contenuti e archivi. Le sue uscite sono proposte, salvo la modalità di correzione automatica espressamente abilitata nel Modulo 4.  
**NFR-AI-01.** Ogni invocazione AI deve registrare provider/modello, versione del template di istruzioni, timestamp, finalità, identità del docente, identificativi delle fonti, esito ed eventuale approvazione/modifica umana. Le informazioni sensibili nei log devono essere minimizzate.  
**NFR-AI-02.** Prima di inviare risposte degli studenti a un provider AI, il sistema deve mostrare al docente la finalità e i dati trasmessi e richiedere un consenso operativo esplicito per la singola elaborazione o per una configurazione persistente chiaramente revocabile.

Il vincolo "solo dalle lezioni selezionate" riguarda il corpus operativo e l'assenza di recupero esterno. L'architettura non deve dichiarare di poter eliminare la conoscenza pregressa di un modello fondazionale; deve invece impedire browsing/RAG esterno, limitare il contesto e richiedere evidenza di provenienza.

## 12. Esportazione ed erogazione

### 12.1 PDF

**FR-OUT-01.** Il docente deve poter esportare ogni Versione pronta o pubblicata in PDF.  
**FR-OUT-02.** Il PDF della prova deve riportare almeno: titolo/verifica, identificativo della versione, elenco delle domande, spazi o istruzioni di risposta coerenti con il tipo di domanda e data di generazione. Non deve includere soluzione, chiavi di risposta o rubrica.  
**FR-OUT-03.** Il sistema deve poter generare PDF separati e archiviabili per prova, soluzione e rubrica, chiaramente etichettati e collegati alla specifica Versione.  
**BR-OUT-01.** Ogni PDF archiviato deve riportare o essere collegato a un identificatore immutabile della Versione e a una data/ora di generazione.

### 12.2 Google Forms

**FR-GF-01.** Il sistema deve poter esportare una Versione pubblicata come Google Form, creando una corrispondenza persistente tra identificativo della Versione, identificativi delle domande SchoolForge e identificativi delle domande del Form.  
**FR-GF-02.** L'esportazione deve supportare domande aperte, a scelta singola e a scelta multipla nei limiti consentiti dal canale. Ogni incompatibilità deve bloccare l'esportazione e indicare domanda e motivazione.  
**FR-GF-03.** Il Form deve essere configurato affinché l'identificazione del rispondente sia possibile tramite account Google/email raccolta dal Form. Se la configurazione del dominio o dell'account non consente un'identificazione affidabile, il sistema non deve pubblicare l'assegnazione digitale e deve indicare l'azione correttiva al docente.  
**FR-GF-04.** Dopo l'esportazione il sistema deve memorizzare il collegamento al Form e rendere disponibile il relativo URL al docente. La notifica automatica via email non è requisito della V1; il docente può distribuire il link tramite canali esterni.  
**BR-GF-01.** Un Form già usato per acquisire almeno una Consegna non può essere rigenerato modificandone le domande. Qualunque variazione richiede una nuova Versione e un nuovo Form.  
**BR-GF-02.** Le risposte importate dal Form devono essere ricondotte a una sola Versione e a un solo Studente; risposte non identificabili, duplicate o non mappabili devono essere messe in quarantena e richiedere una decisione esplicita del docente.

## 13. Classi, studenti e assegnazioni

**FR-ANAG-01.** Il docente deve poter creare, rinominare, archiviare e consultare Classi.  
**FR-ANAG-02.** Il docente deve poter creare, modificare, archiviare e cercare Studenti con almeno nome, cognome, email e Classe di appartenenza.  
**BR-ANAG-01.** L'email dello Studente deve essere sintatticamente valida e univoca all'interno del set di Studenti attivi. Una modifica di email non deve scollegare consegne storiche già attribuite; deve creare una traccia dell'identificativo precedente.  
**FR-ASS-01.** Il docente deve poter creare un'Assegnazione scegliendo una Versione pubblicata, una Classe intera o un insieme esplicito di Studenti, e un canale (`PDF` o `Google Forms`).  
**FR-ASS-02.** Il sistema deve registrare data/ora di creazione, destinatari, Versione, canale, URL Google Form se applicabile e stato dell'Assegnazione.  
**BR-ASS-01.** Gli stati sono `preparata`, `erogata`, `chiusa`, `annullata`. Solo `erogata` può acquisire nuove Consegne; l'operazione di chiusura non modifica le Consegne già raccolte.  
**BR-ASS-02.** La gestione di una Classe o Assegnazione non crea account SchoolForge per gli studenti né concede loro autorizzazioni applicative.

## 14. Archiviazione e storico — Modulo 3

### 14.1 Acquisizione e conservazione

**FR-ARC-01.** Il sistema deve poter acquisire risposte provenienti da Google Forms per un Form collegato a una Versione; deve inoltre consentire al docente l'inserimento o l'importazione manuale di una Consegna per le prove erogate in PDF o in altro canale esterno.  
**FR-ARC-02.** Per ogni Consegna il sistema deve conservare almeno: Verifica, Versione, Studente, Classe al momento dell'assegnazione, data/ora, risposte, commenti, punteggi e voto finale.  
**FR-ARC-03.** Il docente deve poter associare alla Consegna allegati e PDF archiviabili; il sistema deve visualizzare il collegamento alla prova, alla soluzione, alla rubrica e alle fonti didattiche usate.  
**FR-ARC-04.** Il docente deve poter consultare lo storico filtrando almeno per Programma, UDA, Lezione fonte, Classe, Studente, Verifica, Versione, intervallo di date e stato di correzione.  
**BR-ARC-01.** Una Consegna acquisita è immutabile nel dato sorgente. Rettifiche di risposte, punteggi, commenti o voto devono essere registrate come modifiche tracciate con autore, data, valore precedente, nuovo valore e motivazione.  
**BR-ARC-02.** La Classe e la Versione visualizzate nello storico sono quelle dell'Assegnazione/consegna originaria, anche se lo Studente cambia classe in seguito.  
**BR-ARC-03.** Una Consegna priva di Studente identificato o Versione mappata non entra nello storico definitivo; resta in quarantena fino alla risoluzione o allo scarto esplicito del docente.

### 14.2 Punteggi e voto

**FR-ARC-05.** Il sistema deve calcolare e conservare il punteggio ottenuto, il punteggio massimo e, se previsto dalla regola selezionata, il voto finale. Il docente deve poter inserire o rettificare manualmente il voto con motivazione.  
**BR-ARC-04.** Ogni Verifica pubblicata deve avere una regola di conversione punteggio-voto esplicita oppure deve essere marcata come "voto da inserire manualmente". La regola effettiva deve essere congelata con la Versione.  
**BR-ARC-05.** Il voto non deve essere calcolato o mostrato come definitivo se mancano risposte necessarie, punteggi obbligatori o una regola di conversione applicabile.

### 14.3 Criteri di accettazione del Modulo 3

**AC-ARC-01.** Data una risposta Google Forms con email corrispondente a uno Studente e mappatura di una Versione, quando viene importata, allora il sistema crea una Consegna collegata a quello Studente, Classe storica e Versione.  
**AC-ARC-02.** Data una risposta senza mappatura certa, quando viene importata, allora non è associata automaticamente a uno Studente né inclusa nello storico definitivo.  
**AC-ARC-03.** Data una rettifica di un voto, quando il docente la conferma, allora lo storico conserva sia il voto precedente sia quello nuovo, con autore, data e motivazione.

## 15. Correzione AI — Modulo 4

**FR-COR-01.** In modalità assistita l'AI deve poter proporre, per ogni risposta, punteggio, motivazione e commento usando esclusivamente: Lezione/revisione fonte, domanda, soluzione, rubrica e risposta dello Studente.  
**FR-COR-02.** La proposta AI deve essere mostrata separatamente dalla correzione definitiva. Il docente deve poter approvare, modificare o rifiutare ogni proposta prima di renderla definitiva.  
**FR-COR-03.** La valutazione deve poter riconoscere risposte equivalenti, terminologia tecnica appropriata, approfondimenti corretti e conoscenze superiori ai requisiti minimi, sempre entro il punteggio massimo e i criteri della rubrica.  
**FR-COR-04.** La modalità automatica può assegnare e approvare una correzione soltanto se è abilitata esplicitamente dal docente per la specifica Verifica o Assegnazione. Ogni esito deve essere marcato `automatico` e rimanere modificabile dal docente con traccia completa.  
**BR-COR-01.** La modalità predefinita è assistita. La modalità automatica non deve essere attivata per default, né inferita dalla configurazione di un'altra Verifica.  
**BR-COR-02.** Se mancano domanda, soluzione, rubrica, risposta o revisione fonte, la correzione AI deve essere bloccata per l'item interessato e il sistema deve richiedere correzione manuale o integrazione dei dati.  
**BR-COR-03.** La proposta AI non può superare il punteggio massimo della domanda e deve citare i criteri della rubrica applicati.  
**NFR-COR-01.** L'archivio deve distinguere inequivocabilmente: punteggio proposto da AI, punteggio approvato/modificato dal docente, punteggio assegnato automaticamente e punteggio definitivo.

## 16. Requisiti trasversali di qualità, sicurezza e tutela dati

### 16.1 Integrità, tracciabilità e audit

**NFR-INT-01.** Il sistema deve conservare revisioni immutabili delle fonti usate da ogni Versione, oltre a data/ora e identità dell'operatore delle azioni rilevanti.  
**NFR-INT-02.** Devono essere tracciate almeno: importazione, validazione, sostituzione, disattivazione, esportazione, pubblicazione, assegnazione, acquisizione di consegne, modifica di correzioni/voti, azioni AI e cambi di configurazione sensibili.  
**NFR-INT-03.** Il sistema deve impedire riferimenti orfani tra entità del dominio e deve segnalare ogni incoerenza rilevata senza eliminare dati storici.  
**NFR-INT-04.** Backup e ripristino devono includere Markdown, asset, indice, archivi, collegamenti alle fonti e log di audit necessari a ricostruire lo storico. La frequenza, il RPO e il RTO sono decisioni di esercizio [C].

### 16.2 Sicurezza e privacy

**NFR-SEC-01.** Dati personali, risposte, voti, asset e credenziali/tokens di integrazione devono essere protetti in transito e a riposo secondo lo stato dell'arte applicabile. I segreti non devono comparire in Markdown, esportazioni, log applicativi o UI non autorizzate.  
**NFR-SEC-02.** Il principio di minimizzazione deve applicarsi a raccolta, visualizzazione, esportazione e trasmissione a servizi terzi.  
**NFR-SEC-03.** Il sistema deve permettere esportazione e cancellazione/restrizione dei dati personali secondo politica di conservazione e obblighi applicabili, preservando quando necessario una traccia di audit non identificativa.  
**NFR-SEC-04.** L'architettura deve separare i permessi delle integrazioni Google e AI, richiedere il minimo privilegio e consentire revoca/rotazione senza perdita degli archivi già acquisiti.  
**NFR-SEC-05.** Prima del go-live devono essere definiti [C] titolare/responsabili del trattamento, luogo di conservazione, base giuridica, informativa, tempi di conservazione, procedura per minori e valutazione dell'uso del provider AI. Queste decisioni non sono sostituibili da una scelta tecnica.

### 16.3 Usabilità, accessibilità e operatività

**NFR-UX-01.** Ogni operazione irreversibile o con impatto storico (eliminazione, disattivazione, pubblicazione, annullamento, importazione massiva, chiusura assegnazione, attivazione correzione automatica) deve mostrare conseguenze e richiedere conferma esplicita.  
**NFR-UX-02.** Errori e stati bloccanti devono indicare oggetto, causa, effetto e azione correttiva; non devono essere esposti solo come codici tecnici.  
**NFR-ACC-01.** Le funzioni del docente devono essere utilizzabili da tastiera, con struttura semantica e contrasto adeguato; tema chiaro e scuro non devono ridurre leggibilità o distinguibilità degli stati.  
**NFR-OPS-01.** L'architettura deve prevedere monitoraggio di errori di importazione, rendering, integrazione Google, invocazioni AI, esportazioni e backup, senza registrare inutilmente contenuti didattici o dati personali nei sistemi di telemetria.

## 17. Roadmap e dipendenze di rilascio

| Modulo | Capacità rilasciata | Dipendenze consentite | Condizione di uscita |
|---|---|---|---|
| 1. Repository Didattico | Programmi, UDA, Markdown, asset, validazione, rendering, export | Autenticazione del docente e persistenza locale/applicativa | Funziona senza AI, Google Forms, studenti o archivi |
| 2. Generazione Verifiche | Corpus selezionato, domande, versioni, soluzioni, rubriche, PDF; Google Forms se configurato | Modulo 1; AI solo opzionale | Prove riproducibili dalle revisioni fonte; percorso interamente manuale disponibile |
| 3. Archiviazione e Storico | Classi, studenti, assegnazioni, consegne, correzioni, PDF archivio | Moduli 1–2; Google Forms opzionale perché resta import manuale | Storico filtrabile e rettifiche auditabili |
| 4. Correzione AI | Proposte assistite e modalità automatica esplicitamente abilitata | Modulo 3 e provider AI configurato | Ogni punteggio distingue origine AI/umana/automatica e ha contesto tracciato |

**BR-REL-01.** Non è consentito anticipare una dipendenza dei moduli successivi come requisito obbligatorio di un modulo precedente.  
**BR-REL-02.** La disponibilità di Google Forms o AI non deve compromettere consultazione, esportazione PDF, archivio manuale o correzione manuale.

## 18. Decisioni da confermare prima dell'architettura esecutiva o del go-live

Queste non sono lacune che l'architetto può risolvere arbitrariamente: richiedono una decisione del committente o del responsabile di esercizio. Fino alla conferma devono essere implementate come configurazioni, non come costanti nascoste.

| ID | Decisione | Impatto | Scadenza |
|---|---|---|---|
| C-01 | Metodo di autenticazione del Docente proprietario e procedura di recupero accesso | Sicurezza e operatività | Prima del Modulo 1 |
| C-02 | Posizione di hosting, backup, RPO/RTO e responsabilità operativa | Dati e continuità | Prima del Modulo 1 go-live |
| C-03 | Volume atteso e tempi massimi per operazioni chiave | Dimensionamento e test prestazionali | Prima del design tecnico finale |
| C-04 | Scala di voto e regole di conversione punteggio-voto da rendere disponibili | Archivio e correzione | Prima del Modulo 3 |
| C-05 | Politica di conservazione/cancellazione, base giuridica e disciplina dei dati di minori | Privacy e retention | Prima del caricamento di dati studenti |
| C-06 | Account/dominio Google, modalità ammessa di raccolta email e autorizzazioni per Forms | Google Forms | Prima del Modulo 2 con Forms |
| C-07 | Provider AI, condizioni contrattuali, residenza dati e consenso operativo per l'invio di risposte | AI e privacy | Prima dei moduli AI |
| C-08 | Regola didattica per uso della correzione automatica, inclusa eventuale revisione umana obbligatoria | Rischio valutativo | Prima del Modulo 4 |

## 19. Matrice di tracciabilità dei vincoli fondamentali

| Decisione del brief | Requisiti che la rendono verificabile |
|---|---|
| Markdown indipendente dal sistema | BR-CORE-01, BR-MD-04, FR-REP-08 |
| Lezione come fonte unica | BR-CORE-02, BR-DOM-02, FR-VER-01/02, BR-AI-01 |
| AI opzionale | BR-CORE-04, FR-AI-01, BR-VER-04, BR-REL-02 |
| Single docente / nessun accesso studenti | FR-AUTH-01/02, BR-AUTH-01, BR-ASS-02 |
| Non è un LMS/registro | Sezioni 4.2 e 5; assenza di funzionalità studente |
| Verifiche da UDA/lezioni | FR-VER-01/02 |
| Nessuna fonte web per AI | BR-AI-01/02/03 |
| Google Forms digitale prioritario | FR-GF-01–04, BR-GF-01/02 |
| Archiviazione autonoma dall'AI | FR-ARC-01–05, BR-CORE-04 |
| Correzione AI assistita/automatica | FR-COR-01–04, BR-COR-01–03 |
| Evoluzione modulare | BR-CORE-05, sezione 17 |

## 20. Criteri globali di accettazione della baseline

La progettazione architetturale potrà essere considerata conforme a questa analisi solo se dimostra, con componenti, flussi, modello dati e piano di test, almeno quanto segue:

1. il Markdown e gli asset rimangono leggibili ed esportabili senza SchoolForge;
2. una Verifica pubblicata è riproducibile dalle precise revisioni di lezione registrate;
3. l'AI è assente per default, non usa retrieval/web e non blocca i flussi manuali;
4. domande, soluzioni e rubriche non sono esposte agli studenti tramite la fruizione delle lezioni;
5. Google Forms conserva una mappatura affidabile tra Form, Versione, domande e risposte, oppure blocca chiaramente l'operazione;
6. ogni dato di consegna e voto è attribuibile, storicizzato e rettificabile senza perdita della versione precedente;
7. azioni sensibili, integrazioni e proposte AI sono auditabili;
8. gli elementi fuori scope non emergono surrettiziamente come dipendenze del primo rilascio;
9. le decisioni C-01–C-08 sono gestite come configurazioni o formalmente risolte prima del rilascio pertinente.

---

## Appendice A — Stato del documento

Questo documento è una baseline funzionale completa rispetto al brief ricevuto. Non approva tecnologie né sostituisce le decisioni di esercizio e conformità elencate nella sezione 18. Qualunque modifica a principi Markdown-first, knowledge-first, AI optional, single-docente, assenza di account studenti o divieto di fonti web per la generazione AI costituisce modifica di perimetro e richiede approvazione esplicita del committente.
