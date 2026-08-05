# STRUCTURE-IMPORT — Importazione di UDA e lezioni senza contenuto

> **Stato:** contratto congelato; **STRUCTURE-IMPORT-01 implementato** (solo
> strato puro: parser, validatori, modelli e planner). Nessuna importazione
> reale è disponibile: non esistono ancora voci di menu, dialog, scritture
> Firestore o upload. `02A`, `02B`, `03` e il Gate GSTRUCT restano aperti.
> Questo documento non autorizza merge, deploy o migrazioni.

## 1. Obiettivo

Permettere al docente di preparare rapidamente lo scheletro didattico di un
corso senza importare contenuti, pool o soluzioni:

1. dal corso, un file YAML aggiunge più UDA con i rispettivi metadati;
2. da una UDA, un file YAML aggiunge più lezioni con i rispettivi metadati;
3. ogni lezione nasce con corpo Markdown vuoto e pool assente;
4. il docente può poi aprirla, modificare i metadati e usare la generazione IA
   già esistente per produrre il contenuto.

Il modulo è un acceleratore del lavoro docente, non un nuovo import ZIP e non
un generatore IA.

## 2. Superfici UI definitive

I comandi vivono nei menu **Azioni** già presenti in Didattica. Non vengono
aggiunti pulsanti permanenti alle toolbar o alle card.

| Contesto | Nuova voce | Risultato |
|---|---|---|
| `Didattica → corso → Azioni` | **Importa struttura UDA** | Accoda tutte le UDA valide del file all'import attivo del corso. |
| `Didattica → corso → UDA → Azioni` | **Importa lezioni** | Accoda tutte le lezioni valide del file alla UDA aperta. |

Le azioni esistenti **Importa ZIP** e **Importa UDA** restano invariate:
importano contenuti completi. Le nuove azioni dichiarano sempre
“solo metadati, nessun contenuto”.

Ogni dialog riusa `DialogShell` e ha quattro stati:

1. selezione file e link **Scarica modello YAML**;
2. validazione locale;
3. riepilogo leggibile dell'append (numero, titoli, destinazione, errori);
4. importazione e risultato.

Non sono previste mappature campo-per-campo, drag-and-drop obbligatorio,
wizard multipagina o conferme annidate.

## 3. Formato UDA

Nome consigliato: `schoolforge-udas.yaml`.

```yaml
schema: schoolforge-uda-metadata/v1

udas:
  - titolo: Introduzione alle reti
    descrizione: Fondamenti della comunicazione tra dispositivi.
    competenze:
      - Comprendere il funzionamento generale di una rete
      - Distinguere i principali dispositivi di rete
    obiettivi:
      - Conoscere il concetto di protocollo
      - Comprendere il ruolo degli indirizzi IP

  - titolo: Il livello di trasporto
    descrizione: Affidabilità e comunicazione end-to-end.
    competenze:
      - Analizzare una comunicazione TCP e UDP
    obiettivi:
      - Comprendere affidabilità e ritrasmissione
      - Confrontare TCP e UDP
```

Contratto chiuso di ogni voce:

- `titolo`: obbligatorio, stringa non vuota, massimo 300 caratteri;
- `descrizione`: facoltativa, stringa non vuota se presente;
- `competenze`: obbligatoria, da 1 a 40 stringhe non vuote;
- `obiettivi`: obbligatorio, da 1 a 40 stringhe non vuote;
- ogni voce di lista: massimo 300 caratteri;
- proprietà sconosciute: errore bloccante.

## 4. Formato lezioni

Nome consigliato: `schoolforge-lezioni.yaml`. La UDA di destinazione è quella
aperta nel workspace: il file non contiene ID, nomi tecnici o riferimenti alla
destinazione.

```yaml
schema: schoolforge-lesson-metadata/v1

lessons:
  - titolo: Che cos'è una rete
    sottotitolo: Dispositivi, collegamenti e comunicazione
    difficolta: introduttiva
    concettiChiave:
      - nodo
      - collegamento
      - protocollo
    obiettivi:
      - Definire correttamente una rete informatica
      - Distinguere nodi e collegamenti

  - titolo: Indirizzi IP e instradamento
    sottotitolo: Come i pacchetti raggiungono la destinazione
    difficolta: intermedia
    concettiChiave:
      - indirizzo IP
      - pacchetto
      - router
      - instradamento
    obiettivi:
      - Comprendere la funzione dell'indirizzo IP
      - Ricostruire il percorso logico di un pacchetto
```

Contratto chiuso di ogni voce, allineato ai limiti del payload IA esistente:

- `titolo`: obbligatorio, massimo 300 caratteri;
- `sottotitolo`: facoltativo, massimo 300 caratteri;
- `difficolta`: obbligatoria, massimo 120 caratteri;
- `concettiChiave`: obbligatorio, da 1 a 40 elementi;
- `obiettivi`: obbligatorio, da 1 a 40 elementi;
- ogni concetto/obiettivo: massimo 300 caratteri;
- nessun `body`, `content`, HTML, Markdown, pool, domanda, soluzione o ID;
- proprietà sconosciute: errore bloccante.

## 5. Limiti operativi

- solo `.yaml` e `.yml`, UTF-8;
- massimo 256.000 byte UTF-8 per file;
- da 1 a 40 UDA per importazione;
- da 1 a 40 lezioni per importazione, coerente con
  `UDA_ARCHIVE_LIMITS.MAX_LESSONS`;
- documenti YAML multipli, alias, anchor, tag custom e chiavi duplicate sono
  rifiutati;
- normalizzazione limitata a trim esterno delle stringhe;
- nessun troncamento, completamento o valore inventato.

Il file è validato integralmente prima di qualsiasi lettura di collisione,
upload o scrittura. Un solo errore rifiuta l'intero file.

## 6. Append, ordine e collisioni

- L'operazione è esclusivamente **append-only**.
- L'ordine nel file è l'ordine aggiunto dopo l'ultimo elemento esistente.
- Numeri tecnici, slug, `dir`, filename, document ID, `order`, Storage path e
  `publicLessonId` sono prodotti dal sistema, mai accettati dal file.
- Titoli duplicati nel file o nella destinazione, confrontati dopo trim e senza
  distinzione maiuscole/minuscole, bloccano l'intera operazione.
- Collisioni tecniche Firestore/Storage bloccano prima delle scritture.
- Nessun merge, overwrite, rinomina automatica o aggiornamento di record
  esistenti.
- Il retry con la stessa `requestId` e lo stesso manifest è idempotente; una
  `requestId` riusata con contenuto diverso fallisce chiusa.

## 7. Materializzazione canonica

### 7.1 UDA

Ogni voce viene materializzata con le stesse regole di `createUda`:

- file `uda-XX-slug/uda-XX-slug.md` con front matter canonico e corpo vuoto;
- `UdaDoc` owner-only con `lessonCount: 0`;
- ordine successivo all'ultima UDA esistente;
- audit event coerente con le creazioni manuali.

### 7.2 Lezioni

Ogni voce viene materializzata con le stesse regole di `createLesson`:

- file `lezione-XXX-slug.md` con front matter canonico e corpo vuoto;
- `LessonDoc` con `poolStatus: 'absent'`, `questionCount: 0` e nessun pool;
- proiezione `publicLessons` coerente con il contratto corrente;
- incremento unico di `lessonCount` pari al numero di lezioni importate;
- ordine successivo all'ultima lezione esistente.

Il servizio bulk non deve chiamare `createUda`/`createLesson` in un ciclo:
quelle funzioni rileggono e committano un elemento alla volta, permettendo
risultati parziali. Deve invece riusarne parser, compositori, slug/ID e campi
canonici tramite helper estratti e puri.

## 8. Protocollo di scrittura e rollback

1. parse e validazione locale completa;
2. lettura puntuale della destinazione e costruzione di un manifest puro;
3. preflight di tutte le collisioni Firestore e Storage;
4. acquisizione della mutua esclusione dell'import attivo, riusando e
   generalizzando il lease già impiegato da `Importa UDA`;
5. upload dei soli file canonici via Storage Gateway same-origin, concorrenza
   massima 3;
6. singolo commit Firestore atomico per i documenti del batch, proiezioni,
   conteggi, audit e rilascio lease;
7. aggiornamento locale dell'albero senza rilettura finale.

Errore prima del commit: cleanup idempotente limitato ai path e agli ID presenti
nel manifest del tentativo. Il cleanup non elimina mai dati preesistenti. Se
l'implementazione non può dimostrare il riuso sicuro del lease o richiede nuove
Rules/Function/indice, deve fermarsi e separare il prerequisito in una PR
motivata.

## 9. Visibilità studente degli scheletri

Il contratto attuale crea una `publicLessons` anche per una nuova lezione con
corpo vuoto. Per non mostrare card di lezioni ancora prive di contenuto, il
reader studente deve omettere dalla propria UI le proiezioni il cui `content` è
la stringa vuota. Il salvataggio canonico del primo corpo non vuoto le rende
nuovamente visibili senza nuove letture o nuovi campi.

Questo è un filtro di prodotto, non un confine di segretezza: un alunno già
autorizzato al corso può tecnicamente leggere i metadati della proiezione vuota
secondo le Rules correnti. Un embargo rigoroso sui titoli futuri richiederebbe
un campo di pubblicazione e Rules dedicate ed è fuori scope.

## 10. Contesto IA: gap reale e fase dedicata

La generazione lezione corrente usa:

- titolo, sottotitolo, difficoltà, concetti chiave e obiettivi della lezione;
- titolo UDA;
- indice ordinato di titoli e sottotitoli delle lezioni dell'UDA.

Non usa ancora `descrizione`, `competenze` e `obiettivi` dell'UDA. Per sfruttare
davvero i metadati UDA importati, `STRUCTURE-IMPORT-03` estende il contesto IA
con questi soli campi, presi dall'albero già caricato: zero nuove letture,
payload chiuso e limitato, validazione server, partecipazione all'`inputHash` e
stima costo calcolata sul payload reale. Nessun corpo o metadato delle altre
lezioni viene aggiunto.

## 11. Costi

Zero costo passivo: nessun listener, polling, Function o IA.

| Operazione | Letture/scritture indicative |
|---|---|
| Apertura del dialog | 0 Firebase |
| Validazione file | 0 Firebase |
| Import UDA | letture di preflight proporzionali ai target; 1 upload + 1 `UdaDoc` + audit per UDA, più lease/conteggi |
| Import lezioni | letture di preflight proporzionali ai target; 1 upload + 1 `LessonDoc` + 1 `publicLessons` + audit per lezione, più lease/conteggi |
| Uso ordinario senza import | invariato |

La futura estensione del contesto IA aumenta soltanto i token del singolo prompt
di generazione; non introduce chiamate aggiuntive.

## 12. Roadmap

| Pacchetto | Scope | Stato/DoD |
|---|---|---|
| **STRUCTURE-IMPORT-00** | Contratto, formati, UX, protocollo, costi e roadmap. | Questo documento; solo documentazione. |
| **STRUCTURE-IMPORT-01** ✅ | Parser YAML isolati, validatori fail-closed, normalizzazione, template scaricabili, planner puro di ID/order/manifest e test di collisione. Nessuna UI e nessuna scrittura. | **Implementato** in `apps/web/src/features/repository/structureImport/`. Suite completa su fixture valide/malformate, alias/ancore/tag/documenti multipli/chiavi duplicate/extra key/limiti; helper canonici estratti in `repository/canonicalNaming.ts` senza cambiare il comportamento di `createUda`/`createLesson`; test statico di purezza sull'intera chiusura transitiva degli import. Nessun runtime Firebase mutato. |
| **STRUCTURE-IMPORT-02A** | `Azioni corso → Importa struttura UDA`, dialog, preview e append atomico delle UDA. | Nessun risultato parziale; retry idempotente; cleanup limitato; UI aggiornata senza refetch. |
| **STRUCTURE-IMPORT-02B** | `Azioni UDA → Importa lezioni`, dialog, preview, append atomico, corpi vuoti/pool assenti e filtro UI studente degli scheletri vuoti. | Nessuna lezione nella UDA sbagliata; conteggi/ordine/proiezioni coerenti; nessuna card vuota lato studente. |
| **STRUCTURE-IMPORT-03** | Contesto IA UDA bounded (`descrizione`, `competenze`, `obiettivi`) dai dati già in memoria. | Zero nuove letture; payload/inputHash/stima aggiornati; gerarchia prompt invariata salvo il nuovo contesto autorevole. |
| **Gate GSTRUCT** | Smoke DEV docente/studente e chiusura evidenze. | Import UDA + lezioni, collisione, retry, mobile/Brave, generazione IA da uno scheletro, nessuna esposizione di card vuote. |

## 13. Fuori scope

- contenuto Markdown o HTML nel file;
- pool, domande, soluzioni e generazione IA durante l'import;
- import combinato corso+UDA+lezioni in un unico archivio;
- CSV/XLSX, mappatura colonne o file proprietari;
- aggiornamento massivo di UDA/lezioni esistenti;
- migrazione automatica dei corsi legacy;
- listener, polling, nuova Cloud Function o nuovo indice impliciti;
- deploy PROD.

## 14. Stato dell'implementazione — STRUCTURE-IMPORT-01

Solo lo strato puro. Nulla di quanto segue legge o scrive Firestore o Storage,
e nulla è ancora raggiungibile dall'interfaccia.

### 14.1 Moduli

Tutti in `apps/web/src/features/repository/structureImport/`:

| Modulo | Ruolo |
|---|---|
| `limits.ts` | Limiti, estensioni ammesse e identificatori esatti dei due schemi. |
| `types.ts` | Errori tipizzati, metadati normalizzati, artefatti pianificati e i due manifest. |
| `decodeStructureImportFile.ts` | Caricamento **byte-first**: estensione, limite dimensionale sui byte originali, decodifica UTF-8 in modalità fatale, rimozione del BOM. |
| `parseStructureYaml.ts` | Lettura YAML fail-closed: un solo documento, nessuna chiave duplicata, nessuna ancora/alias, nessun tag esplicito, radice oggetto. |
| `entryFields.ts` | Regole di campo condivise: chiave chiusa, stringhe non vuote, liste limitate, chiave di confronto dei titoli. |
| `validateStructureRoot.ts` | Radice chiusa (`schema` + elenco), schema esatto, limiti dell'elenco, collisioni di titolo. |
| `validateUdaMetadataFile.ts` | Contratto §3. |
| `validateLessonMetadataFile.ts` | Contratto §4, con divieto esplicito dei campi di contenuto. |
| `structureImportTemplates.ts` | I due modelli canonici, verificati in round-trip dai parser reali. |
| `structureManifestCanonical.ts` | **Serializzazione canonica** del manifest — non un'identità: vedi §14.2. |
| `planUdaMetadataAppend.ts` | Manifest §7.1. |
| `planLessonMetadataAppend.ts` | Manifest §7.2. |
| `index.ts` | Superficie pubblica del pacchetto. |

Gli helper canonici condivisi con i servizi esistenti vivono in
`apps/web/src/features/repository/canonicalNaming.ts`: `toDocId`, `slugify`,
numerazione e `order` di UDA e lezioni, nomi e path canonici, mappatura del
front matter. Sono stati **estratti** da `import/buildImportPayload.ts` e da
`editor/repositoryEditorService.ts` a comportamento invariato: il planner li
riusa invece di ri-derivarli, e un test di regressione fissa ogni caso limite
già gestito (buchi di numerazione, `order` legacy assente, slug degenere).

### 14.2 Identità di un tentativo: SHA-256 in 02A/02B

Lo strato puro produce `manifestCanonical`, la serializzazione canonica e
stabile dell'intero manifest. **Non è un'identità.** L'identità autorevole del
tentativo è:

```
SHA-256(manifestCanonical)
```

e la calcola l'adapter runtime di STRUCTURE-IMPORT-02A/02B con Web Crypto
(`crypto.subtle.digest`), **prima** del lease, dello staging e di qualunque
scrittura. Non è calcolata qui per una sola ragione: `subtle.digest` è
asincrona, e i planner devono restare puri e sincroni. 02A/02B possono
persistere il solo hash: la serializzazione completa non deve essere salvata.

La serializzazione garantisce che *manifest uguali producano stringhe uguali* e
*manifest diversi producano stringhe diverse*: chiavi ordinate (l'ordine delle
proprietà non è semantico), ordine degli array conservato (lo è), proprietà
`undefined` omesse, valori con escape JSON e chiavi con lunghezza prefissata,
più un tag di versione del formato. L'assenza di collisioni è responsabilità di
SHA-256, non di questo strato: nessun test dichiara che «ogni modifica produce
sicuramente un hash diverso».

Il fingerprint **FNV-1a a 32 bit** usato dal vecchio flusso «Importa UDA»
(`importUda/manifestHash.ts`) resta un valore **diagnostico non autorevole** ed
è deliberatamente non riusato qui: 32 bit collidono troppo facilmente per
decidere uguaglianza, replay, lease o idempotenza. Quel flusso è rimasto
invariato.

### 14.3 Codifica: byte-first e UTF-8 fatale

Il percorso autorevole parte dai byte originali (`Uint8Array`/`ArrayBuffer`),
mai da testo già decodificato:

1. estensione `.yaml`/`.yml` verificata prima di leggere qualsiasi cosa;
2. limite di 256.000 byte misurato **sui byte originali**, prima della
   decodifica;
3. decodifica con `TextDecoder('utf-8', { fatal: true })`: byte non validi o
   sequenze troncate producono l'errore stabile `invalid_encoding`;
4. eventuale BOM UTF-8 rimosso.

**02A/02B devono usare `file.arrayBuffer()`** e passare i byte. `File.text()`
non è una sorgente ammessa: sostituisce silenziosamente i byte non validi con
U+FFFD, e un file corrotto verrebbe importato con i titoli rovinati invece di
essere rifiutato. Un test statico vieta `.text()`, `FileReader`, `readAsText` e
`Blob(` nei moduli del pacchetto.

`TextDecoder`/`TextEncoder` sono ammessi come primitive pure di piattaforma:
nessun DOM, nessuna rete, nessun temporizzatore.

### 14.4 Confine puro

Un test statico percorre l'intera chiusura transitiva degli import a partire dai
nuovi moduli e vieta di raggiungere Firebase, Firebase Admin, Cloud Functions,
React, React Router, il gateway Storage e l'inizializzazione Firebase; verifica
inoltre che l'unica dipendenza esterna raggiunta sia `yaml`, già presente nel
progetto, e che nessun modulo usi API del browser o temporizzatori.

### 14.5 Scelte da confermare in 02A/02B

- **Ordine legacy delle lezioni.** Il planner, a differenza di `createLesson`,
  ricade sul prefisso `lezione-XXX` quando una lezione esistente non ha `order`
  (è la stessa fonte legacy che `reorderLesson` già usa). Appendere una lezione
  alla volta rende innocuo trattarla come `-1`; appenderne quaranta a una UDA
  legacy no. Il comportamento runtime di `createLesson` resta invariato.
- **Identità del tentativo.** 02A/02B devono calcolare `SHA-256` e usarlo come
  chiave di idempotenza; una `requestId` riusata con un hash diverso deve
  fallire chiusa.
- **`createdAt` della proiezione.** Il manifest non lo contiene: è un timestamp
  di server e un planner puro non deve inventarlo. Lo aggiungerà il commit.
- **Collisioni tecniche.** I guardrail su id e Storage path sono difese in
  profondità: con la numerazione canonica non dovrebbero essere raggiungibili,
  e il preflight reale di 02A/02B resta comunque obbligatorio.
