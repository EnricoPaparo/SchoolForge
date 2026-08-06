# STRUCTURE-IMPORT — Importazione di UDA e lezioni senza contenuto

> **Stato:** contratto congelato; **STRUCTURE-IMPORT-01, 02A, 02B, 03 e
> SIMPLE-01 implementati**. Sono reali sia `Azioni corso → Importa struttura UDA` sia
> `Azioni UDA → Importa lezioni`, e la generazione lezione riceve il contesto
> generale dell'UDA. **Il Gate GSTRUCT resta aperto.** Questo documento non
> autorizza merge, deploy o migrazioni.

## 1. Obiettivo

Permettere al docente di preparare rapidamente lo scheletro didattico di un
corso senza importare contenuti, pool o soluzioni:

1. dal corso, una struttura YAML aggiunge più UDA con i rispettivi metadati;
2. da una UDA, una struttura YAML aggiunge più lezioni con i rispettivi
   metadati;
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
| `Didattica → corso → Azioni` | **Importa struttura UDA** | Accoda tutte le UDA valide della struttura all'import attivo del corso. |
| `Didattica → corso → UDA → Azioni` | **Importa lezioni** | Accoda tutte le lezioni valide della struttura alla UDA aperta. |

Le azioni esistenti **Importa ZIP** e **Importa UDA** restano invariate:
importano contenuti completi. Le nuove azioni dichiarano sempre
“solo metadati, nessun contenuto”.

Ogni dialog riusa `DialogShell` e ha quattro stati:

1. inserimento della struttura YAML in una textarea (**Verifica struttura**);
2. validazione locale;
3. riepilogo leggibile dell'append (numero, titoli, destinazione, errori);
4. conferma, importazione e risultato.

Non sono previste mappature campo-per-campo, drag-and-drop, selezione di file,
wizard multipagina o conferme annidate. Gli esempi copiabili vivono nella
sezione **Template**, unico punto autorevole: i dialog non li duplicano e non
offrono un proprio download (STRUCTURE-IMPORT-UI-PASTE-01, §14.13).

## 3. Formato UDA

Nome consigliato: `schoolforge-udas.yaml`.

```yaml
schema: schoolforge-uda-metadata/v1

udas:
  - titolo: Titolo della prima UDA
    descrizione: Breve descrizione della prima UDA
    competenze:
      - Prima competenza sviluppata dalla UDA
      - Seconda competenza sviluppata dalla UDA
    obiettivi:
      - Primo obiettivo didattico della UDA
      - Secondo obiettivo didattico della UDA

  - titolo: Titolo della seconda UDA
    descrizione: Breve descrizione della seconda UDA
    competenze:
      - Prima competenza sviluppata dalla UDA
      - Seconda competenza sviluppata dalla UDA
    obiettivi:
      - Primo obiettivo didattico della UDA
      - Secondo obiettivo didattico della UDA
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
  - titolo: Titolo della prima lezione
    sottotitolo: Breve sottotitolo della prima lezione
    difficolta: Livello di difficoltà della prima lezione
    concettiChiave:
      - Primo concetto chiave della lezione
      - Secondo concetto chiave della lezione
    obiettivi:
      - Primo obiettivo didattico della lezione
      - Secondo obiettivo didattico della lezione

  - titolo: Titolo della seconda lezione
    sottotitolo: Breve sottotitolo della seconda lezione
    difficolta: Livello di difficoltà della seconda lezione
    concettiChiave:
      - Primo concetto chiave della lezione
      - Secondo concetto chiave della lezione
    obiettivi:
      - Primo obiettivo didattico della lezione
      - Secondo obiettivo didattico della lezione
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

- YAML, UTF-8 (il controllo di estensione si applica solo quando esiste un
  nome file: da UI il docente incolla il testo, quindi non c'è estensione da
  verificare);
- massimo 256.000 byte UTF-8 per importazione;
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

Fino a `STRUCTURE-IMPORT-02B` non usava `descrizione`, `competenze` e
`obiettivi` dell'UDA. Per sfruttare
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
| **STRUCTURE-IMPORT-02A** ✅ | `Azioni corso → Importa struttura UDA`, dialog, preview e append atomico delle UDA. | **Implementato.** Un solo commit transazionale rende visibili insieme tutte le UDA; identità del tentativo `requestId` + `SHA-256(manifestCanonical)`; cleanup limitato al manifest; albero locale aggiornato dal manifest, senza refetch. Nessuna Rule, Function, indice o dipendenza aggiunta. |
| **STRUCTURE-IMPORT-02B** ✅ | `Azioni UDA → Importa lezioni`, dialog, preview, append atomico, corpi vuoti/pool assenti e filtro UI studente degli scheletri vuoti. | **Implementato.** Stessa macchina di 02A (`structureAppendProtocol`), lease **per singola UDA**, commit unico con `LessonDoc` + `publicLessons` + incremento unico di `lessonCount`; identità del tentativo estesa a `kind` e UDA di destinazione; filtro studente sulle proiezioni con `content` vuoto. Nessuna Rule, Function, indice o dipendenza aggiunta. |
| **STRUCTURE-IMPORT-03** ✅ | Contesto IA UDA bounded (`descrizione`, `competenze`, `obiettivi`) dai dati già in memoria. | **Implementato.** I tre campi vivono nello stesso `udaContext` (nessun secondo oggetto parallelo), passano da un unico confine di mapping, partecipano a payload canonico, `inputHash`, replay, stima, prenotazione e prompt effettivo. Zero nuove letture, query, listener o polling. Prompt del pool byte-identico; prompt lezione byte-identico su UDA legacy. Nessuna Rule, Function, indice o dipendenza aggiunta. |
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

### 14.2 SHA-256 autorevole, FNV diagnostico

> L'identità completa di un tentativo è a **due livelli** e vive in §14.7:
> `sourceHash` prima del planner, `manifestHash` dopo. Questa sezione resta il
> riferimento sul *perché* SHA-256 e non FNV, e su *dove* viene calcolato.

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

### 14.5 Protocollo runtime di 02A

Moduli in `apps/web/src/features/repository/structureImportRuntime/`:
`manifestHash.ts` (SHA-256 Web Crypto), `udaStructureImportRepository.ts`
(orchestratore a porte iniettate, senza Firebase) e `udaStructureImportDeps.ts`
(implementazione Firestore + Storage Gateway). La UI è
`features/teacher/ImportUdaStructureDialog.tsx`, richiamata dal menu `Azioni`
del corso.

Ordine fail-closed, invariato e verificato dai test:

1. validazione locale **byte-first** (`file.arrayBuffer()`, mai `File.text()`);
2. lettura autorevole delle sole UDA del corso corrente;
3. piano puro con `planUdaMetadataAppend`;
4. `manifestHash = hex(SHA-256(UTF8(manifestCanonical)))`;
5. sonda di replay su `requestId` + `manifestHash`;
6. preflight collisioni (id UDA e Storage path) — **zero scritture** fino a qui;
7. lease + record del tentativo;
8. upload dei soli file del manifest, concorrenza 3;
9. **commit unico transazionale**: tutte le `UdaDoc`, i conteggi, l'audit e il
   rilascio del lease;
10. aggiornamento locale dell'albero dal manifest;
11. in caso di errore pre-commit, cleanup idempotente limitato al manifest.

**Non esiste una fase di staging**, e non per dimenticanza: una `UdaDoc` è il
proprio marcatore di commit, quindi non c'è alcun documento invisibile da
scrivere in anticipo. Le uniche scritture pre-commit sono il lease e il record
del tentativo.

Il lease riusato è lo stesso campo `udaAppendLease` del flusso «Importa UDA»:
un import strutturale in corso blocca anche creazione, riordino ed eliminazione
manuale di una UDA, e due schede non possono importare insieme. Firestore e
Storage non condividono una transazione: la mitigazione è l'upload dei soli file
del manifest e il loro cleanup mirato — un file caricato senza commit resta un
orfano dentro i path del tentativo, mai una modifica di contenuti esistenti.
Nessun rollback distribuito è dichiarato.

Le UDA importate non contengono lezioni e **non producono alcuna proiezione
studente**.

### 14.6 Stato del tentativo, precondizioni e recovery

Il record del tentativo vive in
`programs/{p}/imports/{i}/structureImportAttempts/{requestId}` e la sua
classificazione è pura e testabile (`structureImportRuntime/attemptState.ts`):

| Stato | Condizione | Effetto |
|---|---|---|
| `none` | nessun record | tentativo nuovo |
| `committed` | stesso `requestId` e hash, `status: 'committed'` | replay: successo, zero scritture |
| `conflict` | stesso `requestId`, hash diverso | fail-closed |
| `resumable` | stesso `requestId` e hash, `kind: 'uda'`, `udaIds` e `storagePaths` identici, `status: 'reserved'` | riprendibile |
| `incoherent` | record parziale, malformato o divergente | fail-closed, **mai riparato né sovrascritto** |

**Precondizioni del commit** (tutte obbligatorie, verificate dentro la
transazione con un clock iniettabile): `activeImportId` invariato; `ownerUid`
del programma ancora uguale a quello del manifest; lease **presente**, ben
formata, non scaduta, con lo stesso `requestId` e lo stesso `manifestHash`;
record del tentativo presente, coerente e ancora `reserved`; nessuna delle
`UdaDoc` di destinazione già esistente. Un lease assente o scaduto **non** è un
permesso: è la condizione in cui numerazione, `order` o destinazione possono
essere già cambiati. Nulla viene riparato nel commit: si aborta.

Poiché l'upload può durare, prima del commit il lease viene **rinnovato in modo
condizionato**: solo se è ancora nostro e porta ancora questo hash. Un rinnovo
fallito aborta il tentativo.

**Recovery dopo `cleanup_pending`.** Un tentativo `resumable` riprende con la
stessa identità e la stessa finestra: i path elencati nel suo record non sono
collisioni estranee, mentre qualunque altro path esistente blocca. La strategia
scelta — unica e documentata — è il **re-upload idempotente** degli stessi
contenuti: il contenuto è fissato dal manifest di cui il record porta l'hash,
quindi la riscrittura è byte-identica. Nessun cleanup condizionato dei file
seguito da un secondo preflight.

**Cleanup condizionato.** Cancella solo se il record dimostra la proprietà:
stesso `requestId`, stesso `manifestHash`, stesso `kind`, stessi `udaIds`,
stessi `storagePaths`, tentativo non committato — riverificato dentro la
transazione. Un'esecuzione vecchia che si risvegliasse non può quindi rimuovere
lease, record o file del tentativo che l'ha sostituita. Mai un cleanup per
prefisso, mai un dato preesistente.

### 14.7 Identità a due livelli e replay

Un tentativo è identificato da **due** hash SHA-256, entrambi su serializzazione
canonica e nessuno dei due FNV:

| | `sourceHash` | `manifestHash` |
|---|---|---|
| Calcolato | **prima** del planner | dopo il planner |
| Copre | versione del protocollo, `kind`, owner autorevole, `programId`, `activeImportId`, `udaId` (solo lezioni), metadati normalizzati e ordinati del file | il piano completo: id, `order`, filename, Storage path, contenuti |
| Risponde a | «è la stessa richiesta sullo stesso bersaglio?» | «è lo stesso identico piano?» |
| Governa | riconoscimento del replay | lease, resume, commit |

Il primo esiste per una ragione precisa: dopo un commit riuscito la cui risposta
si è persa, i documenti importati **sono già nella destinazione**, il planner li
vede come duplicati e il tentativo fallirebbe *prima* di poter essere
riconosciuto come replay. Il `sourceHash` non dipende dalla destinazione, quindi
resta uguale e il replay viene riconosciuto.

**Ordine definitivo:**

1. validazione byte-first;
2. lettura autorevole della destinazione;
3. costruzione canonica della sorgente;
4. `sourceHash`;
5. sonda del tentativo su `requestId` + `sourceHash` + destinazione;
6. `committed` coerente ⇒ **replay riuscito**, senza planner, preflight, lease,
   upload o scritture;
7. `conflict` / `incoherent` ⇒ fail-closed;
8. `none` / `reserved` ⇒ planner;
9. `manifestHash`;
10. verifica del manifest contro l'eventuale tentativo `resumable`;
11. preflight, lease, upload, rinnovo, commit.

Stesso `requestId` con file modificato ⇒ `conflict`. Stessa sorgente su un'altra
destinazione ⇒ `conflict`. Record legacy o parziale privo dei nuovi campi ⇒
`incoherent`, mai riparato. Stessa sorgente ma piano divergente — una mutazione
concorrente ha spostato numerazione o `order` fra prenotazione e retry ⇒
`incoherent`, fail-closed.

**Esito del replay.** Non viene ricostruito alcun manifest sulla destinazione
ormai modificata: il risultato è `committed_replay`, con gli id e il conteggio
**persistiti nel record** e `requiresReload: true`. La UI mostra il successo e
invita a ricaricare, senza inventare documenti locali e senza ripetere l'import.

### 14.8 Costi, contati dal codice

Le query Firestore sono fatturate **per documento restituito**, e ogni `tx.get`
dentro una transazione è una lettura. Le formule seguenti separano Firestore,
Storage Gateway e upload.

**02A — import di N UDA, con E UDA già presenti nell'import**

| Fase | Letture Firestore | Scritture Firestore | Storage Gateway |
|---|---|---|---|
| Lettura destinazione | 1 (programma) + E (query UDA) | — | — |
| Sonda di sorgente | 1 (record tentativo) | — | — |
| Verifica del piano | 1 (record tentativo) | — | — |
| Preflight | N (`UdaDoc`) | — | 1 lettura batch di N path |
| Prenotazione (transazione) | 2 (programma, import) | 2 (lease, record) | — |
| Upload | — | — | N upload, concorrenza 3 |
| Rinnovo (transazione) | 1 (import) | 1 (lease) | — |
| Commit (transazione) | 3 (programma, import, record) + N (`UdaDoc`) | N + 4 (N `UdaDoc`, import, programma, record, audit) | — |

Totali su un import riuscito: **letture = E + 2N + 9**, **scritture = N + 7**,
**upload = N**, più 1 lettura batch Storage.
Cleanup (solo su errore pre-commit): 1 lettura + 1 lettura in transazione, 1
scrittura (rilascio lease) + 1 delete (record), fino a N delete su Storage.

Esempi con ipotesi esplicite: N=2, E=0 → 13 letture, 9 scritture, 2 upload ·
N=10, E=10 → 39 letture, 17 scritture, 10 upload · N=40, E=20 → 109 letture,
47 scritture, 40 upload.

**02B — import di N lezioni, con E lezioni già presenti nella UDA**

| Fase | Letture Firestore | Scritture Firestore | Storage Gateway |
|---|---|---|---|
| Lettura destinazione | 1 (programma) + 1 (UDA) + E (query lezioni della UDA) | — | — |
| Sonda di sorgente | 1 (record tentativo) | — | — |
| Verifica del piano | 1 (record tentativo) | — | — |
| Preflight | N (`LessonDoc`) + N (`publicLessons`) | — | 1 lettura batch di N path |
| Prenotazione (transazione) | 2 (programma, UDA) | 2 (lease sulla UDA, record) | — |
| Upload | — | — | N upload, concorrenza 3 |
| Rinnovo (transazione) | 1 (UDA) | 1 (lease) | — |
| Commit (transazione) | 3 (programma, UDA, record) + 2N (`LessonDoc` e proiezioni) | 2N + 4 (N `LessonDoc`, N proiezioni, UDA con `lessonCount` e lease, programma, record, audit) | — |

Totali su un import riuscito: **letture = E + 4N + 10**, **scritture = 2N + 7**,
**upload = N**, più 1 lettura batch Storage.
Cleanup (solo su errore pre-commit): 1 + 1 letture, 1 scrittura + 1 delete, fino
a N delete su Storage.

Esempi con ipotesi esplicite: N=3, E=0 → 22 letture, 13 scritture, 3 upload ·
N=15, E=0 → 70 letture, 37 scritture, 15 upload · N=15, E=20 → 90 letture, 37
scritture, 15 upload · N=40, E=20 → 190 letture, 87 scritture, 40 upload.

**Costo passivo: zero** in entrambi i flussi — nessun listener, nessun polling,
nessuna lettura all'apertura ordinaria di corso o UDA, nessuna callable, nessuna
Function, nessuna chiamata IA. Le mutazioni manuali di una lezione pagano **una
lettura in più** (il documento UDA, per il lease), e solo quando il docente muta.

### 14.9 STRUCTURE-IMPORT-02B — import delle lezioni

**UI.** `Didattica → corso → UDA → Azioni → Importa lezioni`, agisce solo sulla
UDA da cui il menu è stato aperto; la destinazione è nominata nel dialog perché
il file non la contiene. Stessi cinque stati e stesso linguaggio di 02A.

**Protocollo condiviso.** Identità, sonda del tentativo, preflight, lease,
upload, rinnovo condizionato, commit e cleanup vivono in
`structureImportRuntime/structureAppendProtocol.ts`, usato **sia** da 02A **sia**
da 02B: una sola macchina, non due simili. Restano specifici del tipo di import
la validazione del file, la lettura della destinazione e il piano.

**Identità del tentativo.** Estesa: oltre a `requestId` e
`SHA-256(manifestCanonical)` comprende ora `kind` (`uda` | `lesson`), la UDA di
destinazione, gli id dei documenti, gli id delle proiezioni e i path. Un
tentativo di import UDA non può quindi valere come replay di un import lezioni,
né un tentativo su un'altra UDA. I record vivono in una collezione dedicata
(`lessonStructureImportAttempts`).

**Lease per singola UDA.** Il lease dell'append lezioni vive sul documento della
UDA (`lessonAppendLease`), non sull'import: due UDA diverse si possono popolare
in parallelo, mentre creazione, riordino ed eliminazione di lezioni **di quella
UDA** — e l'eliminazione della UDA stessa — sono bloccate finché l'import è in
volo. È la granularità più stretta ottenibile senza toccare Rules, Function o
indici. Il commit esige lease presente, valida, non scaduta, dello stesso
`requestId` e dello stesso `manifestHash`, con rinnovo condizionato prima del
commit, esattamente come 02A.

**Commit atomico.** Una sola transazione crea tutti i `LessonDoc`, tutte le
proiezioni `publicLessons`, applica l'**incremento unico** di `lessonCount`,
scrive l'audit, marca il tentativo `committed` e rilascia il lease. Riverifica
programma, owner, `activeImportId`, UDA (esistenza e `dir` invariata), lease,
record del tentativo e assenza di **ogni** documento e proiezione di
destinazione. Nessun documento di staging visibile.

**Visibilità studente.** `loadStudentLessons` omette le proiezioni il cui
`content` è presente ma vuoto o composto di soli spazi. Una proiezione legacy
priva del campo (`null`, pre M3F-08) **non** è filtrata: la UI la gestisce già a
parte. Il primo salvataggio di un corpo reale la rende visibile senza un secondo
percorso di pubblicazione — verificato: `updateLessonMarkdownBody` aggiorna già
`publicLessons.content`. Nessun listener, nessun polling, nessuna lettura per
card. **Non è un confine di sicurezza:** la proiezione resta tecnicamente
leggibile secondo le Rules correnti.

I costi sono nella tabella di §14.8, insieme a quelli di 02A.

### 14.10 Scelte da confermare in 03

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

### 14.11 STRUCTURE-IMPORT-03 — contesto generale dell'UDA nella generazione

Quello che la generazione lezione **già** riceveva, verificato nel codice
(`aiContentCore.parseLessonRequest`, `aiContentPrompt.buildLessonPrompt`,
`CourseWorkspace` → `LessonDetail`): titolo, sottotitolo, difficoltà, concetti
chiave e obiettivi della lezione corrente; titolo dell'UDA; posizione corrente
nell'UDA; indice ordinato delle lezioni dell'UDA con titolo e sottotitolo; corpo
attuale; indicazioni del docente. Il delta mancante era soltanto il **contesto
generale dell'UDA**, ed è l'unica cosa aggiunta.

**Origine del dato.** Esclusivamente l'UDA già presente nell'albero caricato da
`CourseWorkspace` (`tree.udas`), che `listUdas` normalizza già a
`descrizione: string | null`, `competenze: string[]`, `obiettivi: string[]`.
Nessuna nuova lettura, query, listener o polling: il costo passivo è invariato,
e un test strutturale lo difende leggendo il sorgente (`lessonUdaContext.ts` non
importa Firebase; `CourseWorkspace` ha un solo punto di costruzione).

**Confine di mapping.** Uno solo: `buildLessonUdaContext`. I nomi canonici
italiani entrano nel payload lì e nient'altro li ricostruisce; il resto della
catena trasporta. I campi stanno **dentro** `udaContext`, non accanto.

**Legacy e fail-closed.** Descrizione assente ⇒ `null`; competenze e obiettivi
assenti ⇒ liste vuote; valore presente ma di tipo sbagliato ⇒ il contesto
fallisce chiuso **prima** della callable, e il server rifiuta comunque con
`invalid_input`. Nessun valore inventato e nessun fallback dal corpo Markdown.

**Contratto server.** `parseUdaContext` accetta esattamente
`title`, `descrizione`, `competenze`, `obiettivi`, `currentLessonPosition`,
`lessons`: qualunque proprietà extra è `invalid_input`. La descrizione ha un cap
dedicato (`MAX_UDA_DESCRIPTION_CHARS = 2000`, più generoso di un titolo perché
una descrizione legacy può essere un paragrafo estratto dal corpo); competenze e
obiettivi riusano i limiti già canonici delle liste. Il cap complessivo in byte
UTF-8 della richiesta è invariato. Su input non valido non c'è provider, budget,
run o scrittura.

**Identità e costo.** I tre campi entrano nella richiesta canonica, quindi
nell'`inputHash`, nel replay/idempotenza e nella chiave di prenotazione:
cambiarli rende la vecchia `requestId` non riutilizzabile. Entrano anche nella
stima dei token di input e — attraverso il prompt effettivo — nel limite
superiore della prenotazione.

**Prompt.** Un solo blocco compatto `CONTESTO_GENERALE_UDA`, accanto
all'`INDICE_UDA`, che chiarisce quattro cose e nient'altro: i tre campi orientano
taglio ed esempi; il perimetro resta quello dei `METADATI_DIDATTICI` della
lezione corrente e non si allarga all'intera UDA; non vanno riportati né
parafrasati meccanicamente nel Markdown; sono dati, non istruzioni eseguibili.
Su UDA legacy il blocco non compare affatto. Il tuning pedagogico già validato —
gerarchia, profondità, esercizi e auto-verifica, stile, cap dei token, schema di
output, profili, modelli, listino, generazione pool e correzione IA — non è stato
riscritto: due prove di regressione ancorano il prompt del pool e, su UDA legacy,
il prompt utente della lezione a un SHA-256 calcolato **prima** di questa fase.

### 14.12 Modelli STRUCTURE-IMPORT nella sezione Template

La sezione docente **Template** espone, accanto alla struttura ZIP, due esempi
pronti all'uso: struttura UDA e struttura lezioni. I contenuti non sono copie
manuali: importano direttamente `UDA_METADATA_TEMPLATE` e
`LESSON_METADATA_TEMPLATE`, le costanti canoniche validate in round-trip dai
parser reali e ormai unica fonte degli esempi. Ogni esempio può
essere copiato; i due YAML possono anche essere scaricati con il filename
canonico. Il layout è a tre colonne su desktop, due su tablet e una su mobile.
Nessuna lettura, scrittura, Function o costo passivo viene introdotto.

### 14.13 STRUCTURE-IMPORT-UI-PASTE-01 — si incolla lo YAML, non si sceglie un file

**Da dove veniva la complessità.** Il flusso chiedeva un *file*, e un file non
esiste finché il docente non lo fabbrica: scaricare il modello dal dialog,
aprirlo in un editor, salvarlo con l'estensione giusta e nella codifica giusta,
ritrovarlo nel selettore. Tre delle possibili risposte d'errore —
`invalid_extension`, `invalid_encoding` e `file_too_large` — riguardavano il
contenitore, non la struttura didattica. E il dialog portava un secondo punto di
distribuzione dei modelli, in concorrenza con la sezione Template.

**Anatomia definitiva delle due finestre.** Una textarea etichettata
(«Struttura UDA in YAML» / «Struttura lezioni in YAML»), il testo di supporto
«Incolla qui la struttura YAML. Puoi copiare un esempio dalla sezione
Template.», e i comandi «Annulla» / «Verifica struttura». Sono spariti input
file, drag and drop, «Scarica modello YAML», nome e dimensione del file e lo
spazio che occupavano. La macchina degli stati resta quella di sempre:
inserimento → validazione → riepilogo → conferma → importazione → risultato. La
verifica **non** importa: il riepilogo esistente resta un passaggio obbligato.

**Percorso del dato.** `stringa → TextEncoder UTF-8 → limite sui byte → parser e
validatori STRUCTURE-IMPORT-01 → planner e runtime`. È lo stesso ingresso
byte-first di prima: nessun parser testuale parallelo, nessuna
`validate*MetadataFileText` chiamata dalla UI, nessuna API permissiva di lettura
(`FileReader`, `File.text()`) reintrodotta — semplicemente non si legge più
alcun file. Restano invariati schema canonico, rifiuto di documenti multipli,
alias, anchor e tag, chiavi chiuse, limiti, normalizzazione, duplicati,
`sourceHash`, `manifestHash`, idempotenza, collision check, lease, staging,
commit, cleanup e modello di costo.

**Il testo non viene persistito.** Nel record del tentativo finiscono
`requestId`, i due hash, la destinazione, gli id creati e i path; su Storage
finiscono solo i file del manifest (i documenti canonici generati). Lo YAML
incollato non compare in alcun documento, log o audit.

**Su errore.** Il testo resta intatto nella textarea, il focus torna lì, il
controllo è marcato `aria-invalid` e l'errore è annunciato come già avviene nei
dialog. Nessun tentativo, lease, upload o documento viene creato: la validazione
è locale e precede qualunque operazione Firebase.

**Costi.** Invariati. La fase di inserimento e la verifica sono interamente
client-side: zero letture, scritture, upload e callable finché il docente non
conferma il riepilogo, dopodiché vale il modello di costo di §14.8.

### 14.14 STRUCTURE-TEMPLATE-GENERIC-01 — modelli generici, senza nulla da ripulire

Finché il modello si scaricava come file, un esempio disciplinare concreto era
innocuo: il docente lo apriva in un editor e ci lavorava sopra. Da quando lo YAML
si **incolla** (§14.13) l'esempio è diventato un costo: va cancellato riga per
riga prima di scrivere il proprio, e i commenti `#` sono la parte che più
facilmente sopravvive per sbaglio all'incollaggio, con un risultato che sembra
funzionare finché non lo si importa.

I due modelli contengono ora soltanto lo schema tecnico obbligatorio, la
struttura YAML valida e **segnaposto generici** che dicono implicitamente cosa
inserire («Titolo della prima UDA», «Primo obiettivo didattico della lezione»).
Spariti commenti introduttivi, spiegazioni operative e ogni riferimento
disciplinare. La proprietà `schema` resta e non cambia valore: è ciò che i
validatori esigono per riconoscere il formato.

Entrambi mostrano **due voci complete**, con tutti i campi del formato
valorizzati: chi copia vede la forma intera, non una versione minima da
indovinare. Il round-trip con i validatori reali è invariato e resta la difesa
principale — un modello si può ripulire fino a romperlo, e i test lo impediscono.

Le costanti sono l'unica fonte autorevole per visualizzazione e copia della
sezione Template: un test verifica che i due percorsi consegnino gli stessi
identici byte, così il docente non può incollare un testo diverso da quello che
ha letto. Il download YAML è stato rimosso perché il flusso operativo è
copia → incolla. Layout e comportamento responsive
(tre colonne desktop, due tablet, una mobile) restano invariati, misurati in
Chromium a 1440, 1024, 820, 390 e 320 px.

Parser, validatori, planner e runtime non sono stati toccati: sono i modelli a
rispettare il contratto esistente.

### 14.15 STRUCTURE-IMPORT-SIMPLE-01 — un formato che si scrive senza istruzioni

**Il problema.** Lo YAML chiede al docente di essere preciso su cose che non
hanno alcun significato didattico: quanti spazi di rientro, quale carattere per
l'elenco, se il valore va fra virgolette, se serve `schema:`. Chi incolla da un
documento, da una chat o da una risposta AI arriva quasi sempre con una di
quelle differenze — e si vede rifiutare un contenuto perfettamente sensato con un
messaggio che parla di sintassi.

**Il formato semplice.** Etichette in italiano e trattini, nient'altro:

```text
UDA: Titolo della prima UDA
Descrizione: Breve descrizione della prima UDA
Competenze:
- Prima competenza sviluppata dalla UDA
Obiettivi:
- Primo obiettivo didattico della UDA
```

Nessuno `schema:`, nessun rientro, nessuna riga vuota, nessun commento. Una nuova
`UDA:` (o `LEZIONE:`) chiude da sola la voce precedente: non esistono separatori
obbligatori.

**Tollerante sulla forma, rigido sul contenuto.** È la regola che governa tutto.
Vengono assorbiti — perché non cambiano ciò che il docente ha scritto — rientri
con spazi o tab, righe vuote, CRLF/LF/CR, BOM, separatori `---`, etichette in
qualunque combinazione di maiuscole, `Difficoltà`/`Difficolta`,
`Obiettivi`/`Obbiettivi`, spazi attorno ai due punti, i simboli `-`, `*`, `•`,
`·`, `–`, `—`, gli elenchi numerati `1.`/`1)`, le voci senza simbolo dentro una
sezione già aperta, le virgolette esterne (dritte, curve, caporali) e un blocco
di codice Markdown che avvolga tutto.

Gli apostrofi seguono una regola propria, ed è una regola italiana: `'900`,
`’800`, `'60` sono elisioni di secolo o decennio, non virgolette aperte. Un
apostrofo iniziale toglie una coppia **solo** se il valore finisce con lo stesso
carattere; altrimenti resta testo. Il costo di sbagliare è asimmetrico —
rifiutare «'900 e società di massa» come virgoletta non chiusa respingerebbe un
titolo sensato senza che il docente possa capire cosa correggere, mentre leggere
`'Titolo'` come testo lascia due apostrofi visibili e correggibili. Le virgolette
vere (`"`, `“`, `‘`, `«`) restano invece strette: nessuna parola italiana comincia
così, quindi una apertura senza chiusura significa testo troncato. Restano invece errori una riga prima della
prima voce, un titolo o una difficoltà mancanti, un elenco obbligatorio assente o
vuoto, un campo o una sezione ripetuti, un'etichetta sconosciuta, una voce vuota,
virgolette aperte e non chiuse, un fence malformato, un titolo duplicato, i
limiti superati e ogni riga non collocabile. Nulla viene ignorato e nessun valore
viene inventato.

Due decisioni meritano di essere esplicite. Una riga che comincia con un simbolo
di elenco è **sempre** una voce, anche quando contiene i due punti — altrimenti
«- Obiettivo: capire le reti» diventerebbe un campo sconosciuto. E una riga senza
simbolo che somiglia a un'etichetta sbagliata fallisce con il suggerimento:
«Riga 8: campo «Obietivi» non riconosciuto. Forse intendevi «Obiettivi»?».

**Una sola porta.** `parse{Uda,Lesson}StructureInput` è l'unico ingresso: limite
sui byte, decodifica UTF-8 fatale, rimozione del BOM, prima riga significativa →
formato. `schema:` va allo YAML storico, `UDA:` e `LEZIONE:` ai due parser
semplici, tutto il resto è `unknown_format`. Non esiste alcun fallback «prova
l'uno, poi prova l'altro»: trasformerebbe l'errore di un formato nell'errore
dell'altro, e il docente si vedrebbe spiegare il problema sbagliato. Una
struttura di lezioni aperta dalla finestra UDA — o viceversa — produce
`wrong_structure_kind`, con l'indicazione della finestra giusta.

**Il contratto didattico non è duplicato.** Il parser semplice produce voci nella
stessa forma che il parser YAML consegna ai normalizzatori condivisi
(`normalizeUdaEntries`, `normalizeLessonEntries`): da lì in poi limiti, messaggi,
DTO, serializzazione canonica, `sourceHash`, `manifestHash`, planner, lease,
commit e cleanup sono gli stessi. Il percorso YAML è invariato, byte per byte.

**Identità.** Rientri, righe vuote, simboli di elenco e virgolette esterne non
entrano nell'identità del tentativo: trentaquattro grafie diverse dello stesso
contenuto producono un solo DTO e un solo `sourceHash`. Anche lo stesso contenuto
scritto in YAML e in formato semplice è lo stesso tentativo — chi cambia sintassi
senza cambiare una parola non crea un secondo import.

**Nelle due finestre.** Nessun selettore di formato, nessuna modalità avanzata,
nessuna conversione, nessun passaggio in più: la finestra non sa quale sintassi
ha davanti. Il flusso resta incolla → «Verifica struttura» → riepilogo → conferma
→ runtime esistente.

**Sezione Template.** Mostra e copia soltanto i modelli semplici; i modelli YAML
restano esportati come compatibilità, non più come didattica. L'esito della copia
vive nel pulsante della card — `Copia`, `Copiato`, `Riprova` — e il messaggio
globale sotto la griglia è stato rimosso insieme al contenitore che gli riservava
una riga: misurato in Chromium a 1440, 1024, 390 e 320 px, dimensione del
pulsante e altezza della pagina restano identiche fra i tre stati.

**Costi.** Invariati: parsing e riconoscimento sono interamente client-side, e
nulla cambia in letture, scritture, upload o callable.
