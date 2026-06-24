# SchoolForge — Analisi dei requisiti

**Versione:** 2.0  
**Data:** 24 giugno 2026  
**Stato:** baseline di requisiti per la progettazione architetturale  
**Destinatario successivo:** Solution / Software Architect

---

## 1. Scopo, autorità e convenzioni

Questo documento traduce il *Project Concept Brief* in requisiti di prodotto, regole operative, vincoli e criteri di accettazione verificabili. È l'input funzionale per la progettazione architetturale; non prescrive framework, database, provider AI o tecnologia di deployment.

Le decisioni esplicite del brief sono vincolanti. Le specifiche contrassegnate **[D]** sono requisiti derivati: rendono operativa un'intenzione esplicita del brief senza cambiarne il perimetro. Devono essere trattate come baseline, salvo modifica approvata dal committente. Le voci **[C]** sono configurazioni o decisioni di esercizio che devono essere definite prima del relativo rilascio; non devono essere sostituite da assunzioni tecniche nascoste.

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

SchoolForge è un repository didattico personale, **Markdown-first** e **knowledge-first**, per un solo docente. La lezione Markdown è la fonte canonica della conoscenza. Da una selezione esplicita di lezioni e UDA il sistema genera verifiche on-demand, le eroga tramite il Portale Verifiche, raccoglie le consegne digitali e supporta la correzione manuale e, opzionalmente, AI.

Non è un LMS, un registro elettronico né un portale studenti con account. Gli studenti accedono esclusivamente al Portale Verifiche per scaricare o svolgere digitalmente la propria prova. Il PDF non viene mai conservato dal sistema: viene generato al volo, scaricato e dimenticato. L'AI è facoltativa e non può usare fonti web: ogni output dipende esclusivamente dal corpus didattico selezionato.

Il prodotto cresce per moduli indipendenti: il Repository Didattico produce valore senza AI, senza Portale e senza correzione.

## 3. Obiettivi e misure di esito

### 3.1 Obiettivi di prodotto

1. Centralizzare la conoscenza didattica in file Markdown portabili e indipendenti dalla piattaforma.
2. Rendere la conoscenza ricercabile, navigabile e visualizzabile senza modificare i file nel sistema.
3. Generare verifiche on-demand coerenti con la configurazione, con domande distribuite per difficoltà e peso.
4. Raccogliere e storicizzare consegne digitali con punteggi, percentuali e tracciabilità delle rettifiche.
5. Ridurre il lavoro operativo del docente senza trasferire all'AI la governance del processo o la proprietà della conoscenza.

### 3.2 Misure operative V1

Il committente non stabilisce vincoli quantitativi stringenti su volumi, tempi di risposta o disponibilità. L'architettura deve rendere osservabili errori, durate e crescita dei contenuti per consentire una successiva definizione dei target sulla base dell'uso reale.

## 4. Perimetro

### 4.1 Incluso

| Area | Funzione inclusa |
|---|---|
| Repository | Gestione di programmi, UDA (con file UDA.md), lezioni Markdown, pool domande e relativi asset |
| Programma svolto | Export come file testo della struttura UDA/lezioni selezionate dal docente, per deposito presso l'istituto |
| Fruizione | Rendering lezioni con immagini, tema chiaro/scuro, autoverifica visibile, domande di verifica nascoste |
| Verifiche | Configurazione on-demand con selezione corpus, difficoltà, peso, varianti; generazione PDF al volo |
| Portale Verifiche | App separata: download PDF personalizzato o svolgimento digitale; email bruciata; deterrenza di base |
| Pool domande | File `.pool.md` per lezione con tipo, difficoltà, peso e soluzione; punteggio max = coeff_diff × coeff_peso |
| Correzione digitale | Punteggi per item, percentuali, rettifiche tracciate per consegne digitali |
| AI successiva | Generazione domande, correzione assistita e, se espressamente abilitata, automatica |

### 4.2 Escluso

Sono espressamente fuori scope: registro elettronico, presenze, compiti, forum, chat, videolezioni, social learning, LMS completo, portale studenti con account SchoolForge, gestione multi-docente/multi-istituto, editor Markdown integrato, analytics didattiche, profilo studente AI, Google Drive come storage del sistema, Google Forms come canale di erogazione, PDF conservati dal sistema, correzione di prove cartacee nel sistema. La conoscenza proveniente dal web non è una fonte didattica primaria né una fonte consentita per la generazione AI.

## 5. Utenti, ruoli e autorizzazioni

| Ruolo | Descrizione | Permessi |
|---|---|---|
| Docente proprietario | Unico utente applicativo della V1; usa l'account Google Workspace for Education assegnato dall'istituto | Accesso completo a contenuti, configurazioni, output, archivi e azioni AI |
| Studente | Accede al solo Portale Verifiche; non è utente di SchoolForge | Download PDF personalizzato o svolgimento digitale tramite Portale; nessun accesso al repository, alle soluzioni o allo storico |
| Servizio esterno | Provider AI, se configurato | Accesso strettamente limitato allo scopo della singola invocazione |

**FR-AUTH-01.** Il sistema deve autenticare il Docente proprietario tramite il suo account Google Workspace for Education. L'accesso deve essere limitato all'account o al dominio Google Education configurato; account personali o non autorizzati non devono poter accedere.  
**FR-AUTH-02.** La V1 espone un solo ruolo applicativo: Docente proprietario. Non deve introdurre ruoli organizzativi, condivisione tra docenti o deleghe.  
**BR-AUTH-01.** Gli studenti non devono poter autenticarsi in SchoolForge, leggere i contenuti del repository, consultare soluzioni o accedere allo storico delle correzioni.  
**NFR-AUTH-01.** L'identità del Docente deve essere associata a un identificatore Google stabile, non al solo indirizzo email.

## 6. Glossario e modello di dominio

| Entità | Definizione e relazioni essenziali |
|---|---|
| Programma | Materia o percorso didattico. Contiene una o più UDA. |
| UDA | Unità organizzativa principale. Rappresentata da un file `uda-XX-titolo.md` con attributi YAML (titolo, competenze, obiettivi, periodo, ore). Appartiene a un Programma, contiene Lezioni. |
| Lezione | Coppia di file: `lezione-XXX-titolo.md` (contenuto didattico) e `lezione-XXX-titolo.pool.md` (pool domande, opzionale). Appartiene a una UDA per posizione nella cartella. SchoolForge non conserva revisioni storiche. |
| Pool domande | Insieme di domande associate a una Lezione, definite nel file `.pool.md`. Ogni domanda ha tipo, difficoltà, peso e soluzione. |
| Domanda archiviata | Domanda presente nel pool di una Lezione valida, idonea alla selezione per una Verifica. |
| Domanda generata | Proposta prodotta da AI dal corpus autorizzato; utilizzabile solo dopo approvazione esplicita del docente. |
| Verifica | Configurazione immutabile (corpus, n° domande, tipo, difficoltà, peso, varianti) dalla quale viene generato un PDF on-demand per ogni richiedente. Non è un documento pre-generato. |
| Consegna digitale | Insieme di risposte strutturate inviate da uno Studente tramite il Portale Verifiche per una specifica Verifica. Immutabile nel dato sorgente. |
| Correzione | Punteggi, commenti, motivazioni e percentuale associati a una Consegna digitale. Distingue origine manuale e AI. |
| Email bruciata | Email con cui uno studente ha già scaricato o svolto una Verifica. Non può essere riutilizzata per la stessa Verifica. |

### 6.1 Relazioni obbligatorie

```text
Programma 1 ──< UDA (UDA.md) 1 ──< Lezione (content.md + pool.md)
Lezione 1 ──< Domanda archiviata (nel pool)

Verifica (configurazione) ──> genera PDF on-demand per Studente
Verifica ──< Consegna digitale 1 ──1 Correzione
```

**BR-DOM-01.** Ogni identificatore di dominio deve essere stabile e non dipendere da titolo, nome file o posizione di cartella.  
**BR-DOM-02.** Una Verifica pubblicata non dipende dal contenuto corrente delle Lezioni: le domande e le soluzioni selezionate sono parte della configurazione immutabile.  
**BR-DOM-03.** Un nome, un titolo o una UDA possono cambiare senza invalidare Consegne o Correzioni già archiviate.  
**BR-DOM-04.** SchoolForge non conserva revisioni storiche delle Lezioni. La modifica o l'eliminazione di una Lezione agisce solo sul repository corrente.

## 7. Principi e vincoli architetturalmente rilevanti

**BR-CORE-01 — Markdown-first.** La conoscenza didattica esiste in file Markdown standard leggibili al di fuori di SchoolForge. Il database è un indice e un archivio di dati operativi; non è l'unica sede del contenuto didattico.

**BR-CORE-02 — Fonte unica.** Il contenuto delle Lezioni e i pool domande costituiscono il corpus didattico. Verifiche, soluzioni e analisi devono dichiarare la provenienza da tale corpus.

**BR-CORE-03 — Knowledge-first.** In caso di conflitto tra una funzione accessoria e conservazione, portabilità o integrità della conoscenza, deve prevalere la conoscenza.

**BR-CORE-04 — AI optional.** Tutte le funzioni dei Moduli 1–4 devono restare utilizzabili con AI non configurata. L'assenza di AI deve produrre messaggi espliciti e percorsi manuali, non errori bloccanti.

**BR-CORE-05 — Evoluzione incrementale.** Ogni modulo rilasciato è eseguibile senza dipendere dai moduli successivi. Nessun requisito del Modulo 1 può richiedere un provider AI o consegne digitali.

**BR-CORE-06 — PDF non conservato.** Il sistema non archivia mai PDF generati. Il PDF è prodotto on-demand, trasmesso al richiedente e immediatamente eliminato. La responsabilità della conservazione del PDF appartiene al Docente o allo Studente.

## 8. Contratto dei file Markdown — Lesson Contract v1 [D]

Il formato segue Markdown CommonMark con YAML front matter. Le estensioni SchoolForge si limitano al front matter e ai file pool; un file resta leggibile come normale Markdown anche senza l'applicazione.

### 8.1 File UDA — `uda-XX-titolo.md`

```yaml
---
schoolforge: 1
kind: uda
id: "tpsit-3-uda-01"
program_id: "tpsit-3"
title: "Reti e Protocolli"
competencies:
  - "Progettare e realizzare sistemi di elaborazione dati"
objectives:
  - "Comprendere il modello client-server"
  - "Distinguere i principali protocolli di rete"
period: "Ottobre – Dicembre"
hours: 24
---
```

| Campo | Regola |
|---|---|
| `schoolforge` | Obbligatorio; valore `1`. |
| `kind` | Obbligatorio; valore `uda`. |
| `id` | Obbligatorio; univoco nel repository. |
| `program_id` | Obbligatorio; deve identificare un Programma esistente. |
| `title` | Obbligatorio. |
| `competencies` | Obbligatorio; lista non vuota. |
| `objectives` | Obbligatorio; lista non vuota. |
| `period` | Facoltativo. |
| `hours` | Facoltativo; numero intero positivo. |

### 8.2 File lezione — `lezione-XXX-titolo.md`

```yaml
---
schoolforge: 1
kind: lesson
id: "lesson-tpsit-3-01"
program_id: "tpsit-3"
uda_id: "tpsit-3-uda-01"
title: "Introduzione alle reti"
objectives:
  - "Descrivere il modello client-server"
  - "Distinguere LAN e WAN"
---
```

| Campo | Regola |
|---|---|
| `schoolforge` | Obbligatorio; valore `1`. |
| `kind` | Obbligatorio; valore `lesson`. |
| `id` | Obbligatorio; univoco nel repository; non riutilizzabile dopo eliminazione. |
| `program_id` | Obbligatorio. |
| `uda_id` | Obbligatorio; deve identificare una UDA appartenente al `program_id`. |
| `title` | Obbligatorio. |
| `objectives` | Obbligatorio; lista non vuota. |

Il corpo Markdown usa intestazioni di livello 2 nell'ordine: `## Contenuto` (obbligatoria), `## Autoverifica` (facoltativa). Le domande di autoverifica sono blocchi `schoolforge-question` con `kind: self_check` e sono visibili nel rendering di fruizione.

**BR-MD-01.** Il rendering della lezione mostra contenuto, obiettivi e sole domande `self_check`. Non espone mai blocchi del pool domande, soluzioni o opzioni corrette.  
**BR-MD-02.** Il parser segnala con file, riga e motivo ogni violazione del contratto. Non modifica automaticamente il file sorgente.  
**BR-MD-03.** Un file non conforme resta in stato `non_valido` e non contribuisce alla generazione di verifiche. Le Verifiche già configurate rimangono intatte.  
**BR-MD-04.** Il sistema conserva ed esporta i Markdown originali e gli asset senza convertirli in formato proprietario.

### 8.3 File pool domande — `lezione-XXX-titolo.pool.md`

Il file pool è opzionale. Se non presente, la lezione è valida ma non contribuisce alla generazione.

Ogni domanda è un blocco `schoolforge-question` YAML:

````markdown
```schoolforge-question
id: "q-tcpip-01"
type: "open"
difficulty: "media"
weight: "alto"
prompt: "Descrivi il funzionamento del protocollo TCP."
solution: "TCP è un protocollo connection-oriented che garantisce..."
```

```schoolforge-question
id: "q-tcpip-02"
type: "closed_single"
difficulty: "bassa"
weight: "medio"
prompt: "Quale porta usa HTTP di default?"
options:
  - id: "a"
    text: "80"
  - id: "b"
    text: "443"
  - id: "c"
    text: "8080"
correct_option_ids: ["a"]
solution: "HTTP usa la porta 80 per default."
```
````

| Campo | Regola |
|---|---|
| `id` | Obbligatorio; univoco nel file pool; stabile nel tempo. |
| `type` | Obbligatorio: `open`, `closed_single`, `closed_multiple`. |
| `difficulty` | Obbligatorio: `bassa`, `media`, `alta`. |
| `weight` | Obbligatorio: `basso`, `medio`, `alto`. |
| `prompt` | Obbligatorio; testo non vuoto. |
| `solution` | Obbligatorio; risposta modello (aperte) o testo esplicativo. |
| `options` e `correct_option_ids` | Obbligatori per tipi chiusi. |

**Punteggio massimo per domanda** = `coeff_difficoltà × coeff_peso`

| Livello | Coefficiente |
|---|---|
| `bassa` / `basso` | 0.75 |
| `media` / `medio` | 1.00 |
| `alta` / `alto` | 1.50 |

`difficoltà` e `peso` sono attributi semanticamente distinti: `difficoltà` indica il livello cognitivo della domanda e guida la selezione; `peso` indica l'importanza didattica attribuita dal docente e guida il punteggio. Non devono essere usati come sinonimi.

### 8.4 Strategia di versionamento del contratto

**BR-MD-VER-01.** Il campo `schoolforge` è il numero di versione del contratto. Un valore non supportato genera un errore esplicito.  
**BR-MD-VER-02.** La versione è monotonicamente crescente. Ogni cambiamento incompatibile produce `schoolforge: 2`.  
**BR-MD-VER-03.** L'aggiunta di campi opzionali non costituisce breaking change. Il parser v1 ignora campi sconosciuti senza errore.  
**BR-MD-VER-04.** Costituiscono breaking change: rimozione o rinomina di campo obbligatorio, cambio tipo o semantica, aggiunta di campo obbligatorio.  
**BR-MD-VER-05.** Una breaking change non viene distribuita senza strumento o procedura di migrazione documentata.

## 9. Gestione repository didattico — Modulo 1

### 9.1 Programmi e UDA

**FR-REP-01.** Il docente deve poter creare, rinominare, riordinare e disattivare Programmi e UDA.  
**FR-REP-02.** Il docente deve poter creare il file UDA.md con i relativi attributi (titolo, competenze, obiettivi, periodo, ore) direttamente dall'interfaccia, senza editare manualmente il file.  
**BR-REP-01.** Non è consentita l'eliminazione fisica di Programmi o UDA che hanno Lezioni, Verifiche o Consegne collegate. L'operazione è una disattivazione che ne preserva l'identificativo e lo storico.

### 9.2 Acquisizione, sostituzione ed eliminazione lezioni

**FR-REP-03.** Il sistema deve consentire il caricamento di singoli file Markdown e pool, di coppie lezione+pool e di cartelle intere con sottocartelle e asset.  
**FR-REP-04.** Prima della conferma il sistema mostra un resoconto: file validi, file non validi, identificatori duplicati, asset mancanti e azione proposta per ciascun conflitto.  
**FR-REP-05.** Il docente deve poter sostituire una Lezione mediante un nuovo file con lo stesso `id`. La sostituzione aggiorna il contenuto corrente; non crea revisioni storiche e non modifica Verifiche o Consegne già esistenti.  
**FR-REP-06.** Il docente deve poter eliminare una Lezione previa conferma esplicita. L'eliminazione non modifica Verifiche o Consegne già esistenti.  
**FR-REP-07.** Il docente deve poter scaricare il file Markdown originale e gli asset di una Lezione e deve poter esportare l'intero repository come ZIP.  
**BR-REP-02.** Un'importazione a cartella è atomica: se contiene errori bloccanti, nessuna modifica è applicata finché il docente non seleziona le sole unità valide o corregge i file.

### 9.3 Programma svolto

**FR-REP-08.** Il docente deve poter selezionare, per ogni Programma, le UDA e le singole Lezioni effettivamente svolte nel corso dell'anno e scaricare un file di testo con la struttura del programma svolto.  
**BR-REP-03.** Il file generato è in formato testo semplice (`.txt`), non PDF. Contiene: nome del Programma, anno scolastico (se inserito), elenco delle UDA selezionate con le relative Lezioni selezionate. Non include contenuti didattici, soluzioni o dati degli studenti.  
**AC-REP-05.** Dato un Programma con 3 UDA e il docente seleziona 2 UDA e 4 Lezioni su 6 della terza UDA, il file scaricato riporta le 2 UDA complete e la terza con le 4 Lezioni selezionate, senza le 2 escluse.

### 9.4 Consultazione

**FR-REP-09.** Il docente deve poter navigare Programma → UDA → Lezione, cercare per titolo/obiettivo/testo e filtrare per stato di validazione.  
**FR-REP-10.** Il sistema deve renderizzare le Lezioni in tema chiaro e scuro con supporto immagini.  
**NFR-REP-01.** Il rendering deve sanificare HTML e URL, impedendo esecuzione di script e iframe non autorizzati.

### 9.5 Criteri di accettazione del Modulo 1

**AC-REP-01.** Dato un set valido di lezioni con immagini relative, quando il docente lo importa, allora le Lezioni sono visibili nell'UDA dichiarata, le immagini sono renderizzate e i file originali sono scaricabili.  
**AC-REP-02.** Data una Lezione con domande nel pool, quando è aperta in modalità di fruizione, allora il prompt delle domande del pool, le soluzioni e le opzioni corrette non sono visibili.  
**AC-REP-03.** Data una Lezione usata per configurare una Verifica attiva, quando viene sostituita o eliminata, allora la configurazione della Verifica resta invariata e le Consegne già ricevute restano consultabili.  
**AC-REP-04.** Dato un Markdown non valido, quando viene importato, allora il sistema indica il motivo e la riga, non altera il sorgente e non lo rende selezionabile per configurare una nuova Verifica.

## 10. Generazione e gestione delle verifiche — Modulo 2

### 10.1 Verifica come configurazione

Una Verifica non è un documento pre-generato. È un insieme di impostazioni immutabili dalla quale viene prodotto un PDF on-demand al momento della richiesta. Il PDF non viene mai conservato dal sistema.

**FR-VER-01.** Il docente deve poter creare una Verifica selezionando una o più UDA e/o Lezioni come sorgente. La selezione di una UDA include tutte le Lezioni correnti valide con pool non vuoto.  
**FR-VER-02.** Il docente deve definire per la Verifica: titolo, numero totale domande, numero domande aperte, numero domande chiuse, livelli di difficoltà da includere con numero minimo garantito per ciascun livello selezionato, variante (tutte uguali o tutte diverse).  
**BR-VER-01.** `numero totale = domande aperte + domande chiuse`. Tutti i valori sono interi positivi, salvo uno tra aperte e chiuse che può essere zero.  
**BR-VER-02.** Se la somma dei minimi per livello di difficoltà supera il numero totale di domande, il sistema blocca la configurazione con messaggio esplicito prima dell'attivazione.  
**BR-VER-03.** Con variante "tutte uguali" il sistema fissa un seed alla prima generazione e lo riusa per tutti gli studenti. Con variante "tutte diverse" ogni email riceve un seed diverso.  
**BR-VER-04.** Se le domande disponibili nel corpus non soddisfano la configurazione e l'AI non è attiva, il sistema blocca l'attivazione indicando il fabbisogno non coperto.  
**BR-VER-05.** Una Domanda generata da AI non può essere inclusa nella configurazione finché il docente non la esamina e approva esplicitamente.

### 10.2 Attivazione e stati

| Stato | Significato | Transizioni consentite |
|---|---|---|
| `bozza` | Configurazione in lavorazione | `attiva`, `annullata` |
| `attiva` | Visibile agli studenti nel Portale; genera PDF on-demand | `chiusa`, `annullata` |
| `chiusa` | Non accetta nuove richieste; Consegne esistenti consultabili | nessuna |
| `annullata` | Non utilizzabile; Consegne esistenti consultabili | nessuna |

**BR-VER-06.** Solo una Verifica `attiva` può ricevere richieste dal Portale Verifiche.  
**BR-VER-07.** L'annullamento non elimina Consegne o Correzioni già esistenti; deve registrarne motivo e data.  
**BR-VER-08.** Le impostazioni della Verifica diventano immutabili al momento dell'attivazione.

### 10.3 Generazione PDF on-demand

**FR-VER-03.** Quando uno studente accede alla Verifica tramite il Portale, il sistema deve generare al volo un PDF personalizzato con i dati inseriti dallo studente e le domande selezionate secondo la configurazione.  
**FR-VER-04.** Il PDF deve riportare in intestazione: titolo verifica (precompilato), nome (precompilato per studente, vuoto per docente), cognome (precompilato per studente, vuoto per docente), email (precompilata per studente, vuota per docente), classe (precompilata se inserita, vuota altrimenti), data (precompilata con la data del giorno per studente, non presente per docente), campo Punti/Max Punti (vuoto per tutti). Seguono le domande con il punteggio massimo indicato per ciascuna.  
**FR-VER-05.** Il docente deve poter scaricare la Verifica in qualsiasi momento senza inserire dati e senza limitazioni. Il download del docente non brucia email e non modifica lo stato della Verifica.  
**BR-VER-09.** Il PDF generato per uno studente non viene mai salvato dal sistema. Viene prodotto, trasmesso e immediatamente eliminato.  
**BR-VER-10.** Il punteggio massimo di ogni domanda nel PDF è `coeff_difficoltà × coeff_peso` arrotondato a due decimali.

### 10.4 Email bruciata

**FR-VER-06.** Prima di generare il PDF per uno studente, il sistema deve verificare atomicamente che l'email inserita non abbia già scaricato o svolto quella Verifica.  
**BR-VER-11.** Se l'email è già presente nel registro della Verifica, il sistema blocca la richiesta con messaggio esplicito e non genera il PDF.  
**BR-VER-12.** La verifica e la scrittura dell'email nel registro devono avvenire in un'unica operazione atomica per evitare race condition in caso di richieste simultanee con la stessa email.

### 10.5 Criteri di accettazione del Modulo 2

**AC-VER-01.** Dati minimi per difficoltà pari a 3 bassa + 3 media + 3 alta e totale domande 8, quando il docente tenta l'attivazione, allora il sistema la rifiuta con messaggio che spiega la violazione della somma.  
**AC-VER-02.** Data una Verifica attiva, quando uno studente inserisce la sua email e scarica il PDF, allora una seconda richiesta con la stessa email viene bloccata con messaggio esplicito.  
**AC-VER-03.** Data una Verifica attiva con variante "tutte diverse", quando due studenti con email diverse scaricano il PDF, allora possono ricevere set di domande diversi entrambi conformi ai minimi di difficoltà configurati.  
**AC-VER-04.** Quando il docente scarica la Verifica, allora il PDF ha i campi nome/cognome/email vuoti e compilabili a mano, non riporta la data e non brucia nessuna email.

## 11. Portale Verifiche — Modulo 2 (canale digitale)

Il Portale Verifiche è un'applicazione separata accessibile tramite link univoco per verifica. Gestisce sia il download PDF (canale cartaceo) sia lo svolgimento digitale.

### 11.1 Accesso

**FR-POR-01.** Lo studente deve poter selezionare la Verifica tramite il link fornito dal docente, inserire nome, cognome, email scolastica Google e, facoltativamente, classe.  
**FR-POR-02.** Il sistema applica la logica email bruciata prima di procedere in qualsiasi canale (PDF o digitale).  
**BR-POR-01.** Il campo classe è facoltativo e non bloccante. La sua assenza non impedisce né il download né lo svolgimento.

### 11.2 Canale cartaceo — download PDF

**FR-POR-03.** Lo studente deve poter scaricare il PDF personalizzato con nome, cognome, email e data precompilati e classe precompilata se inserita.  
**FR-POR-04.** Il filename del PDF deve includere nome e cognome dello studente per facilitare l'archiviazione fisica (es. `Verifica-Reti-Mario-Rossi.pdf`).

### 11.3 Canale digitale — svolgimento online

**FR-POR-05.** Lo studente deve poter svolgere la Verifica direttamente nel Portale. Il Portale deve mostrare tutte le domande in sequenza verticale, ciascuna con tipo, difficoltà, peso, punteggio massimo e campo risposta (textarea per domande aperte, radio/checkbox per chiuse).  
**FR-POR-06.** Il Portale deve funzionare in modalità fullscreen durante lo svolgimento. Deve rilevare l'uscita dal tab e mostrare un avviso visibile prominente. Deve disabilitare la funzionalità di copia-incolla nell'interfaccia.  
**FR-POR-07.** Un header sticky deve mostrare nome studente e un bottone "Consegna" sempre visibile.  
**FR-POR-08.** Al clic su "Consegna" il sistema deve salvare le risposte strutturate su Firestore con: email, nome, cognome, classe (se inserita), identificativo Verifica, risposta per ogni domanda e timestamp.  
**BR-POR-02.** Le misure di deterrenza (fullscreen, rilevamento tab, disabilitazione copia-incolla UI) non costituiscono garanzie di sicurezza. Il docente è responsabile del controllo durante la prova.  
**BR-POR-03.** Il Portale non deve contenere menu di navigazione, link esterni o elementi non necessari durante lo svolgimento.

### 11.4 Criteri di accettazione del Portale

**AC-POR-01.** Dato uno studente che inserisce email già bruciata, quando tenta l'accesso, allora il sistema blocca la richiesta con messaggio esplicito sia per canale PDF sia per canale digitale.  
**AC-POR-02.** Dato uno studente che svolge la Verifica digitalmente e clicca Consegna, allora le risposte sono salvate su Firestore con tutti i campi obbligatori, l'email è bruciata e il docente può consultare la consegna.

## 12. AI: confini, provenienza e controlli

**FR-AI-01.** Il docente deve poter scegliere se usare AI per la generazione di domande o per la correzione, per singola azione e senza obbligo di attivazione globale.  
**BR-AI-01.** Il contesto inviato all'AI deve contenere esclusivamente il contenuto corrente delle Lezioni selezionate, le istruzioni applicative e le configurazioni della Verifica. Non è consentito includere risultati di ricerca, browser, retrieval web o fonti Internet.  
**BR-AI-02.** Per ogni domanda, soluzione o proposta di correzione generata da AI deve essere conservata una traccia di provenienza sufficiente a ricostruire corpus e configurazione usati.  
**BR-AI-03.** Gli output AI senza provenienza verificabile devono essere marcati non approvabili.  
**BR-AI-04.** L'AI non ha potere di attivazione, chiusura o modifica irreversibile di Verifiche e Consegne. Le sue uscite sono proposte, salvo la modalità di correzione automatica espressamente abilitata nel Modulo 5.  
**NFR-AI-01.** Ogni invocazione AI deve registrare provider/modello, versione del template, timestamp, finalità, identità del docente, identificativi delle fonti, esito ed eventuale approvazione/modifica umana.  
**NFR-AI-02.** Prima di inviare risposte degli studenti a un provider AI, il sistema deve mostrare al docente la finalità e i dati trasmessi e richiedere un consenso operativo esplicito per la singola elaborazione o per una configurazione persistente chiaramente revocabile.  
**NFR-AI-03.** Il sistema deve poter segnalare al docente risposte stilisticamente anomale rispetto al profilo atteso dello studente. Il segnale è una marcatura consultiva; non blocca la correzione né penalizza automaticamente. La soglia è configurabile dal docente.

## 13. Correzione manuale e percentuali — Modulo 3

### 13.1 Consegne digitali

**FR-COR-01.** Il docente deve poter consultare tutte le Consegne digitali ricevute per una Verifica, con nome studente, classe, timestamp e stato di correzione.  
**FR-COR-02.** Il docente deve poter aprire una Consegna e visualizzare domanda per domanda: testo della domanda, soluzione di riferimento, punteggio massimo e risposta dello studente.  
**FR-COR-03.** Il docente deve poter assegnare un punteggio da 0 al massimo per ogni item e aggiungere un commento opzionale.  
**BR-COR-01.** Una Consegna acquisita è immutabile nel dato sorgente. Le rettifiche di punteggi e commenti sono modifiche tracciate sopra il dato originale, non sovrascritture.

### 13.2 Punteggi e percentuali

**FR-COR-04.** Il sistema deve calcolare e conservare automaticamente: punteggio ottenuto (somma punteggi definitivi), punteggio massimo (somma `coeff_diff × coeff_peso` di tutte le domande) e percentuale (`punteggio ottenuto / punteggio massimo × 100`).  
**BR-COR-02.** Il punteggio visualizzato è arrotondato a due decimali; i valori non arrotondati devono essere conservati per eventuali ricalcoli.  
**BR-COR-03.** Se una Consegna ha item privi di punteggio definitivo, la percentuale è contrassegnata come `non_definitiva`. Al completamento di tutti i punteggi o a ogni rettifica il sistema ricalcola automaticamente.  
**BR-COR-04.** SchoolForge non gestisce scale di voto né conversioni percentuale-voto. La percentuale finale è l'unico output numerico del sistema. La conversione in voto è una decisione pedagogica del docente.

### 13.3 Rettifiche

**FR-COR-05.** Il docente deve poter rettificare un punteggio o un commento già assegnato. Ogni rettifica deve registrare: autore, data, valore precedente, nuovo valore e motivazione obbligatoria.  
**BR-COR-05.** Il log delle rettifiche è append-only. Non è consentita la cancellazione di una rettifica registrata.

### 13.4 Criteri di accettazione del Modulo 3

**AC-COR-01.** Il docente assegna punteggi a tutti gli item di una Consegna: il sistema calcola la percentuale definitiva correttamente secondo la formula.  
**AC-COR-02.** Il docente rettifica un punteggio: il sistema conserva valore precedente, nuovo valore, autore, data e motivazione e ricalcola la percentuale.  
**AC-COR-03.** Una Consegna con un item privo di punteggio mostra percentuale contrassegnata come `non_definitiva`.

## 14. Storico e consultazione — Modulo 4

**FR-STO-01.** Il docente deve poter consultare lo storico delle Consegne digitali filtrando almeno per: Programma, UDA, Lezione sorgente, Verifica, nome/email studente, classe, intervallo di date, stato di correzione.  
**FR-STO-02.** Il docente deve poter visualizzare per ogni studente l'elenco delle Verifiche svolte con percentuale e stato di correzione.  
**BR-STO-01.** La classe visualizzata nello storico è quella inserita dallo studente al momento della Consegna, anche se il docente la aggiorna in seguito nel proprio registro.  
**BR-STO-02.** Una Consegna digitale non può essere eliminata dallo storico. Può essere annullata con motivazione tracciata; l'annullamento non cancella i dati ma li esclude dalle aggregazioni.

**AC-STO-01.** Il docente filtra lo storico per una specifica Verifica e ottiene l'elenco di tutte le Consegne con percentuale definitiva o indicatore `non_definitiva`.

## 15. Correzione AI — Modulo 5

**FR-AI-COR-01.** In modalità assistita l'AI deve poter proporre, per ogni risposta, punteggio, motivazione e commento usando esclusivamente: contenuto della Lezione sorgente, domanda, soluzione e risposta dello studente.  
**FR-AI-COR-02.** La proposta AI deve essere mostrata separatamente dalla correzione definitiva. Il docente deve poter approvare, modificare o rifiutare ogni proposta individualmente o in blocco per l'intera Verifica.  
**FR-AI-COR-03.** La valutazione deve poter riconoscere risposte equivalenti, terminologia tecnica appropriata, approfondimenti corretti e conoscenze superiori ai requisiti minimi, sempre entro il punteggio massimo.  
**FR-AI-COR-04.** La modalità automatica può assegnare e approvare una correzione solo se abilitata esplicitamente dal docente per la specifica Verifica. Ogni esito è marcato `automatico` e rimane modificabile con traccia completa.  
**BR-AI-COR-01.** La modalità predefinita è assistita. La modalità automatica non è mai attivata per default.  
**BR-AI-COR-02.** Se mancano domanda, soluzione, risposta o Lezione sorgente, la correzione AI è bloccata per l'item interessato; il sistema richiede correzione manuale.  
**BR-AI-COR-03.** La proposta AI non può superare il punteggio massimo della domanda.  
**BR-AI-COR-04.** L'approvazione massiva mostra prima della conferma numero e identificativi delle proposte incluse, esclude automaticamente quelle bloccate o già gestite dal docente, e registra un audit per ogni Correzione interessata.  
**NFR-AI-COR-01.** L'archivio deve distinguere inequivocabilmente: punteggio proposto da AI, punteggio approvato/modificato dal docente, punteggio assegnato automaticamente e punteggio definitivo.

**AC-AI-COR-01.** Date dieci proposte AI, di cui otto complete e due bloccate, quando il docente conferma l'approvazione massiva, allora le otto diventano definitive, le due restano non approvate e il log registra un'unica azione con l'elenco degli otto item.

## 16. Requisiti trasversali di qualità, sicurezza e tutela dati

### 16.1 Integrità, tracciabilità e audit

**NFR-INT-01.** Il sistema deve conservare la configurazione immutabile di ogni Verifica attivata, i suoi identificativi di Lezione sorgente, data/ora e identità dell'operatore per le azioni rilevanti.  
**NFR-INT-02.** Devono essere tracciate almeno: importazione, validazione, sostituzione, eliminazione, configurazione verifica, attivazione, chiusura, consegna digitale, modifica correzioni/punteggi, azioni AI e cambi di configurazione sensibili.  
**NFR-INT-03.** Il sistema deve impedire riferimenti orfani tra entità del dominio e segnalare ogni incoerenza rilevata senza eliminare dati storici.  
**NFR-INT-04.** Backup e ripristino devono includere Markdown, asset, configurazioni verifiche, consegne digitali, correzioni e log di audit. Frequenza, RPO e RTO sono decisioni di esercizio [C].

### 16.2 Sicurezza e privacy

**NFR-SEC-01.** Dati personali, risposte, punteggi, percentuali, asset e credenziali di integrazione devono essere protetti in transito e a riposo. I segreti non devono comparire in Markdown, esportazioni o log applicativi.  
**NFR-SEC-02.** Il principio di minimizzazione si applica a raccolta, visualizzazione, esportazione e trasmissione a servizi terzi.  
**NFR-SEC-03.** I dati degli studenti raccolti (nome, cognome, email, classe, risposte) devono essere usati esclusivamente per le finalità dichiarate: correzione, storico e analisi didattica del docente.  
**NFR-SEC-04.** L'architettura deve separare i permessi dell'integrazione AI, richiedere il minimo privilegio e consentire revoca/rotazione senza perdita degli archivi già acquisiti.  
**NFR-SEC-05.** Il Portale Verifiche non deve esporre la configurazione della Verifica (soluzioni, opzioni corrette, punteggi) allo studente in nessuna fase dello svolgimento.

### 16.3 Usabilità, accessibilità e operatività

**NFR-UX-01.** Ogni operazione irreversibile (eliminazione, attivazione, chiusura, annullamento verifica, attivazione correzione automatica) deve mostrare conseguenze e richiedere conferma esplicita.  
**NFR-UX-02.** Errori e stati bloccanti devono indicare oggetto, causa, effetto e azione correttiva; non devono essere esposti solo come codici tecnici.  
**NFR-ACC-01.** Le funzioni del docente devono essere utilizzabili da tastiera con struttura semantica e contrasto adeguato. Tema chiaro e scuro non devono ridurre leggibilità o distinguibilità degli stati.  
**NFR-UX-03.** Entrambe le applicazioni (SchoolForge e Portale Verifiche) devono essere responsive. SchoolForge è desktop-first; il Portale è mobile-first.  
**NFR-OPS-01.** L'architettura deve prevedere monitoraggio di errori di importazione, rendering, generazione PDF, invocazioni AI e consegne, senza registrare inutilmente contenuti didattici o dati personali nei sistemi di telemetria.

## 17. Roadmap e dipendenze di rilascio

| Modulo | Capacità rilasciata | Dipendenze | Condizione di uscita |
|---|---|---|---|
| 1. Repository Didattico | Programmi, UDA (UDA.md), lezioni, pool domande, rendering, export ZIP, programma svolto | Autenticazione Google Workspace for Education | Funziona senza AI, senza Portale, senza correzione |
| 2. Verifiche + Portale | Verifica on-demand, email bruciata, PDF personalizzato docente/studente, svolgimento digitale, consegne su Firestore | Modulo 1; AI solo opzionale | PDF generato correttamente; email bruciata atomica; consegna digitale salvata |
| 3. Correzione manuale | Punteggi per item, percentuali, rettifiche tracciate per consegne digitali | Modulo 2 | Docente corregge consegna, ottiene percentuale definitiva, rettifica con traccia completa |
| 4. Storico e consultazione | Storico filtrabile, viste per studente/verifica, annullamento tracciato | Moduli 1–3 | Storico filtrabile e aggregazioni corrette |
| 5. Correzione AI | Generazione domande AI, correzione assistita, rilevamento anomalie stilistiche, approvazione massiva, modalità automatica opt-in | Modulo 3 + decisioni C-02/C-03 | Ogni punteggio distingue origine AI/umana/automatica; contesto tracciato |

**BR-REL-01.** Non è consentito anticipare una dipendenza dei moduli successivi come requisito obbligatorio di un modulo precedente.  
**BR-REL-02.** L'assenza di AI non deve compromettere consultazione, generazione PDF, svolgimento digitale o correzione manuale.

## 18. Decisioni da confermare prima dell'architettura esecutiva o del go-live

| ID | Decisione | Impatto | Owner | Scadenza |
|---|---|---|---|---|
| C-01 | Regione Firebase, politica di backup, RPO/RTO e responsabilità operativa | Dati e continuità | Committente / Responsabile operativo | Prima del Modulo 1 go-live |
| C-02 | Provider AI, condizioni contrattuali, residenza dati e consenso operativo per l'invio di risposte | AI e privacy | Committente | Prima del Modulo 5 |
| C-03 | Regola didattica per uso della correzione automatica, inclusa eventuale revisione umana obbligatoria | Rischio valutativo | Committente / Docente | Prima dell'abilitazione modalità automatica |

Per ciascuna decisione l'Owner produce una scelta documentata entro la scadenza. Il responsabile tecnico segnala con anticipo quando la mancanza rischia di bloccare il delivery.

## 19. Matrice di tracciabilità dei vincoli fondamentali

| Decisione del brief | Requisiti che la rendono verificabile |
|---|---|
| Markdown indipendente dal sistema | BR-CORE-01, BR-MD-04, FR-REP-07 |
| Lezione come fonte unica | BR-CORE-02, BR-DOM-02, FR-VER-01, BR-AI-01 |
| AI opzionale | BR-CORE-04, FR-AI-01, BR-VER-04, BR-REL-02 |
| PDF non conservato | BR-CORE-06, BR-VER-09, FR-VER-05 |
| Single docente / nessun account studenti | FR-AUTH-01/02, BR-AUTH-01, BR-POR-02 |
| Non è un LMS/registro | Sezione 4.2; assenza di funzionalità studente in SchoolForge |
| Verifiche da UDA/lezioni | FR-VER-01/02 |
| Nessuna fonte web per AI | BR-AI-01/02/03 |
| Correzione AI assistita/automatica | FR-AI-COR-01–04, BR-AI-COR-01–04 |
| Evoluzione modulare | BR-CORE-05, sezione 17 |

## 20. Criteri globali di accettazione della baseline

La progettazione architetturale è conforme a questa analisi solo se dimostra, con componenti, flussi, modello dati e piano di test, almeno:

1. il Markdown e gli asset rimangono leggibili ed esportabili senza SchoolForge;
2. la configurazione di una Verifica attivata non viene modificata da successive modifiche o eliminazioni delle Lezioni;
3. il PDF non viene mai conservato dal sistema dopo la trasmissione al richiedente;
4. l'email bruciata è garantita da un'operazione atomica che previene race condition;
5. le soluzioni e le opzioni corrette non sono mai esposte allo studente tramite il Portale;
6. ogni dato di consegna, punteggio e percentuale è attribuibile, storicizzato e rettificabile senza perdita del valore precedente;
7. l'AI è assente per default, non usa retrieval/web e non blocca i flussi manuali;
8. gli elementi fuori scope non emergono come dipendenze del primo rilascio;
9. le decisioni C-01–C-03 sono gestite come configurazioni o formalmente risolte prima del rilascio pertinente.

---

## Appendice A — Stato del documento

Questo documento è la baseline funzionale aggiornata rispetto al brief v2.0. Non approva tecnologie né sostituisce le decisioni di esercizio elencate nella sezione 18. Qualunque modifica a principi Markdown-first, knowledge-first, AI optional, single-docente, PDF non conservato, assenza di account studenti o divieto di fonti web per la generazione AI costituisce modifica di perimetro e richiede approvazione esplicita del committente.
