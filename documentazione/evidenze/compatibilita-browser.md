# Compatibilità browser — caricamento contenuti lezione

Stato della compatibilità per il caricamento del contenuto lezione nel
workspace Didattica docente (`CourseWorkspace` → `fetchLessonContent` →
Firebase Storage `getBytes`).

| Browser | Piattaforma | Caricamento lezione | Note |
|---|---|---|---|
| Safari | mobile (iOS) | ✅ funziona | Stesso account/lezione di Brave. |
| Chrome | desktop | ✅ funziona | Percorso desktop = percorso mobile (MOB-01). |
| **Brave** | **mobile** | ✅ **funziona (confermato dopo MOB-01C)** | In precedenza il caricamento restava a lungo in attesa e falliva con `storage/retry-limit-exceeded` (httpStatus 0, ~120s): la lettura Storage `getBytes` non completava il round-trip. Dopo MOB-01C la consultazione legge il corpo dalla proiezione Firestore `publicLessons.content` (nessun `getBytes`) e il caricamento funziona su Brave mobile reale. |

## Brave mobile — diagnosi (MOB-01B) e correzione (MOB-01C)

I percorsi desktop e mobile usano lo stesso `selectLesson()`, lo stesso
`storageRef` e una sola lettura (dimostrato in MOB-01); le Storage Rules
gateano la lettura solo su `request.auth.uid == ownerUid`, senza distinzione
per dispositivo o browser. La diagnostica MOB-01B (pannello "Dettagli
tecnici" + "Riprova") ha raccolto l'evidenza reale su DEV per Brave mobile:

- `code: storage/retry-limit-exceeded`
- `httpStatus: 0`
- `elapsedMs: 120588`
- `online: true`

cioè la richiesta `getBytes` a Firebase Storage non completa il round-trip su
Brave e fallisce solo dopo l'esaurimento dei retry automatici di Firebase
(~120s), mentre Safari mobile funziona.

**Correzione (MOB-01C)**: la consultazione del corpo lezione nel workspace
docente legge in via primaria la proiezione Firestore già esistente
`publicLessons/{lessonId}.content` (un solo `getDoc` deterministico, validato
per `ownerUid`/`programId`/`importId`), che è già la sorgente esclusiva lato
studente. La lettura Storage `getBytes` resta solo come **fallback legacy**
per proiezioni assenti/non valide/incoerenti. Nessuna nuova collezione,
schema, indice, dipendenza, Cloud Function, proxy o modifica CORS; nessun
aumento di `maxOperationRetryTime`. La diagnostica MOB-01B resta attiva e ora
mostra anche la voce **`Sorgente`** (`Firestore publicLessons` /
`Storage legacy fallback`).

La proiezione non contiene pool né dati privati: Storage resta owner-only e il
comportamento studente è invariato.

## Flussi ancora dipendenti da Storage diretto (Brave a rischio)

MOB-01C ha risolto **solo** la consultazione della lezione. Restano **diretti**
su Firebase Storage — e quindi potenzialmente **bloccabili su Brave mobile,
anche in scrittura**: pool (lettura/salvataggio/eliminazione), modifica
contenuto/metadata Markdown di lezioni e UDA, import, export, eliminazioni,
backfill `publicLessons.content`, e il caricamento domande in
preparazione/attivazione verifica e per il PDF soluzioni.

La soluzione **approvata ma non ancora implementata** è il **Repository Storage
Gateway same-origin** (`/api/repository/*` → Hosting rewrite → Cloud Function →
Admin SDK → Storage): contratto in
[storage-gateway-roadmap.md](../storage-gateway-roadmap.md) (**SGW**). Finché
SGW non è implementato, questi flussi vanno considerati **non affidabili su
Brave mobile**.
