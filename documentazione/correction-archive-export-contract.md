# CORR-PDF-01 — Export delle correzioni per archivio scolastico

**Stato:** CORR-PDF-01 implementato, distribuito e verificato su DEV; **Gate
GTWU PASS** — vedi [checklist finale](evidenze/gtwu-checklist-finale.md).

## 1. Obiettivo

Il docente deve poter archiviare nel Drive scolastico la correzione completa di
ogni singolo studente. L'unità documentale è quindi **la consegna dello
studente**, non la verifica o la selezione batch.

Decisione definitiva:

- viene prodotto **un PDF autonomo per ogni studente selezionato**;
- non viene mai generato un PDF cumulativo con più studenti;
- con una sola consegna selezionata il browser scarica direttamente il PDF;
- con più consegne selezionate il browser scarica **uno ZIP di trasporto** che
  contiene un PDF distinto per ciascuno studente. Lo ZIP non cambia l'unità
  archivistica: i documenti da conservare restano i singoli PDF.

Il PDF cumulativo potrà essere valutato in futuro, ma è esplicitamente fuori
scope da `CORR-PDF-01`.

## 2. Punto di ingresso e selezione

L'azione è collocata nella toolbar batch sopra la tabella «Consegne online» e
opera sulle checkbox già esistenti. Deve rispettare selezione, ordinamento e
filtri correnti senza modificarli o deselezionare righe.

Sono esportabili soltanto consegne con correzione consolidata:

- `completed`;
- `returned`.

Le consegne `submitted` o `in_progress` sono escluse, con riepilogo leggibile
del numero di selezionate, esportabili ed escluse. Se nessuna consegna è
esportabile non parte alcuna generazione o download.

## 3. Contenuto obbligatorio di ciascun PDF

Ogni PDF contiene esclusivamente i dati della singola consegna:

1. titolo della verifica;
2. nome e cognome dello studente;
3. classe;
4. data e ora della consegna, se disponibili;
5. stato della correzione;
6. punteggio ottenuto, punteggio massimo e percentuale;
7. per ogni domanda assegnata allo studente, nell'ordine canonico della sua
   consegna:
   - testo della domanda;
   - per le domande chiuse, tutte le opzioni con checkbox vettoriali allineate
     (croce sulle selezionate) e la soluzione corretta congelata; nelle
     multiple, più soluzioni corrette sono presentate come elenco puntato;
   - per le domande aperte, risposta consegnata senza esportare la soluzione
     campione del pool;
   - punti attribuiti e massimo della domanda;
   - correzione/feedback docente della domanda;
8. feedback generale della consegna, se presente.

Per le verifiche VEX si esportano **soltanto le domande della variante
assegnata**, usando lo stesso resolver fail-closed già adottato da correzione,
restituzione e registro. Non devono comparire alternative non assegnate.

## 4. Dati esclusi

Il documento di archivio non contiene:

- soluzioni campione delle domande aperte;
- alternative VEX non assegnate;
- UID Firebase, `submissionId`, codici tecnici o path Firestore/Storage;
- log tecnici, eventi anti-cheating o diagnostica;
- logo o dicitura «SchoolForge».

Il PDF deve essere un documento scolastico neutro e leggibile, non una stampa
tecnica dell'applicazione.

## 5. Nomi dei file

I nomi devono essere sanitizzati, deterministici e leggibili. Forma raccomandata:

```text
Cognome_Nome_Titolo_verifica.pdf
```

Per selezione multipla:

```text
Titolo_verifica_correzioni.zip
├── Cognome_Nome_Titolo_verifica.pdf
├── Cognome_Nome_Titolo_verifica.pdf
└── ...
```

Collisioni tra nomi uguali vanno risolte localmente con un suffisso numerico
deterministico (`_2`, `_3`, ...), senza esporre identificatori tecnici.

## 6. Architettura, costi e privacy

- Generazione interamente **browser-side** usando i dati già caricati o le
  letture owner-only strettamente necessarie alla singola esportazione.
- Nessun upload su Firebase Storage, nessun nuovo documento Firestore, nessuna
  Cloud Function, nessun listener o polling.
- Per la selezione multipla si riusa la dipendenza ZIP già presente nel
  progetto: nessuna nuova libreria.
- Nessuna persistenza dei PDF o dello ZIP da parte di SchoolForge.
- Guardia anti doppio-click, indicatore inline e rilascio sempre garantito dello
  stato busy anche in caso di errore.
- Un errore relativo a uno studente non deve produrre un archivio ambiguo: la UI
  deve mostrare chiaramente quali PDF non sono stati generati. Nessun falso
  successo.

## 7. Gestione dei moduli dinamici PDF — CHUNK-RECOVERY-01 ✅ IMPLEMENTATO

Il browser può mantenere aperta una versione precedente dell'app dopo un deploy
e tentare di caricare un vecchio chunk hashato di `jsPDF`, ottenendo ad esempio:

```text
Failed to fetch dynamically imported module: .../assets/jspdf.es.min-*.js
```

Contratto di recovery:

- intercettare il fallimento del `dynamic import` e impedire una rejection non
  gestita in console;
- mostrare un messaggio esplicito e non tecnico:
  «SchoolForge è stato aggiornato. Ricarica la pagina e riprova.»;
- offrire un pulsante **«Ricarica pagina»**;
- non effettuare reload automatici, perché potrebbero esistere modifiche non
  salvate;
- distinguere questo caso dagli errori generici di generazione PDF, che devono
  mantenere il normale messaggio «Impossibile generare il PDF. Riprova.»;
- applicare lo stesso helper di caricamento/recovery alle superfici PDF che
  caricano `jsPDF` dinamicamente, incluso «Programma svolto (PDF)» e il nuovo
  export per-studente.

`CHUNK-RECOVERY-01` è implementato per «Programma svolto (PDF)» con un helper
tipizzato riusabile. Il PDF della singola lezione non è stato modificato.
`CORR-PDF-01` riusa lo stesso helper sia per l'export archivistico sia per il
Registro Correzioni. Il PDF della singola lezione non è stato modificato.

## 8. UX minima

- Pulsante batch coerente con la toolbar esistente, con icona PDF/archivio e
  label leggibile.
- Nessuna nuova pagina e nessun dialog complesso.
- Conferma compatta solo se serve comunicare esclusioni o il numero di file che
  saranno prodotti.
- Durante la generazione: spinner inline e testo «Preparazione PDF…»; nessuna
  percentuale fittizia.
- Su mobile nessun overflow orizzontale e nessuna regressione della toolbar.
- Selezione invariata al termine, sia in caso di successo sia di errore.

## 9. Criteri di accettazione

1. Una consegna selezionata produce un solo PDF relativo a quello studente.
2. Più consegne producono uno ZIP contenente esattamente un PDF per studente e
   mai un PDF cumulativo.
3. Ogni PDF usa il titolo reale della verifica come intestazione e contiene
   domanda, risposta, punteggio e correzione per domanda, più feedback generale
   quando presente; le chiuse includono tutte le opzioni e la soluzione corretta.
4. `submitted`/`in_progress` sono escluse senza generare documenti incompleti.
5. VEX include soltanto la variante assegnata.
6. Nessuna soluzione campione aperta, alternativa VEX non assegnata, PII
   tecnica o marchio SchoolForge compare nel file.
7. Nessuna scrittura Firebase o upload Storage viene effettuato.
8. Il fallimento di un vecchio chunk PDF mostra la recovery esplicita e non una
   rejection non gestita.
9. Nomi file sanitizzati e collisioni risolte senza UID.
10. Test renderer/export, selezione singola/multipla, esclusioni, VEX,
    collisioni nome, errore parziale e chunk recovery verdi; smoke visuale DEV
    su PDF singolo e ZIP multiplo.

## 10. Ordine consigliato

1. `CHUNK-RECOVERY-01` — implementato: helper comune e fix «Programma svolto
   (PDF)».
2. `TWU-03/03A/03B` — implementati: toolbar e visibilità/restituzione.
3. `CORR-PDF-01` — implementato: loader autorevole, modello chiuso, renderer
   PDF per-studente e ZIP all-or-nothing.
4. Smoke DEV completato e Gate GTWU superato — vedi
   [checklist finale](evidenze/gtwu-checklist-finale.md).

## 11. Implementazione CORR-PDF-01

L'export usa la verifica già caricata e, soltanto al click, legge per ogni
consegna esportabile `submissions/{submissionId}` e
`corrections/{submissionId}` con concorrenza massima 3. Non legge
`correctionReturns`, pool live, Storage o `publishedProjection` e non esegue
scritture. Il modello passato al renderer è chiuso: contiene soltanto le
soluzioni delle domande chiuse già assegnate, espresse come testo leggibile, e
non contiene UID, identificatori tecnici, codici di consegna o documenti
Firestore grezzi. Le soluzioni campione delle aperte restano escluse.

Per `same_questions` usa tutte le domande congelate; per
`equivalent_variants` passa obbligatoriamente da `resolveAssignedQuestions` e
fallisce in modo chiuso su assegnazione, risposte, valutazioni, opzioni o totali
incoerenti. Una selezione singola scarica un PDF; una selezione multipla genera
prima tutti i PDF e scarica lo ZIP soltanto se ogni documento è valido. Nomi
duplicati sono risolti localmente con `_2`, `_3`, preservando l'ordine della
tabella.
