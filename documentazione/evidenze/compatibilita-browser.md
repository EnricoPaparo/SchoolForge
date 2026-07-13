# Compatibilità browser — caricamento contenuti lezione

Stato della compatibilità per il caricamento del contenuto lezione nel
workspace Didattica docente (`CourseWorkspace` → `fetchLessonContent` →
Firebase Storage `getBytes`).

| Browser | Piattaforma | Caricamento lezione | Note |
|---|---|---|---|
| Safari | mobile (iOS) | ✅ funziona | Stesso account/lezione di Brave. |
| Chrome | desktop | ✅ funziona | Percorso desktop = percorso mobile (MOB-01). |
| **Brave** | **mobile** | ⚠️ **da verificare** | Il caricamento resta a lungo in attesa e termina per timeout con "Impossibile caricare il contenuto della lezione", anche con Shields disattivati, dati puliti e nuovo login. |

## Brave mobile — diagnosi in corso (MOB-01B)

Non è stata individuata una causa certa lato codice: i percorsi desktop e
mobile usano lo stesso `selectLesson()`, lo stesso `storageRef` e una sola
lettura (dimostrato in MOB-01). Le Storage Rules gateano la lettura solo su
`request.auth.uid == ownerUid`, senza alcuna distinzione per dispositivo o
browser.

MOB-01B aggiunge una **diagnostica utente non sensibile** (pannello
"Dettagli tecnici" + pulsante "Riprova") che, al prossimo fallimento su Brave
mobile reale, permette di leggere: codice Firebase Storage, categoria, stato
HTTP, **durata (`elapsedMs`)**, se il fallimento è avvenuto **dopo i retry
automatici di Firebase**, online/offline, browser sintetico e bucket. Non
vengono mostrati token, header `Authorization`, `serverResponse`, URL firmati
o dati personali.

**Ancora da verificare**: raccogliere codice ed `elapsedMs` reali da Brave
mobile per decidere l'intervento. Nessuna modifica speculativa applicata
(niente aumento di `maxOperationRetryTime`, niente retry aggiuntivi oltre al
"Riprova" manuale, niente fallback `getDownloadURL`/`fetch`, proxy o modifiche
CORS).
