# FIRESTORE-READS-01 — evidenza tecnica

## Obiettivo

Evitare le riletture duplicate di `students/{uid}` all'ingresso nel portale
studente, senza cambiare interfaccia, modello dati o confini di sicurezza.

## Flusso risultante

`RoleGate` legge già il documento studente per autorizzare l'accesso e passa il
`classId` risultante a `StudentShell` e alla prima lettura della libreria
Didattica. Il valore alimenta anche il controllo per classe della Modalità
verifica. In questo modo l'apertura iniziale usa una sola lettura del documento
studente invece di tre.

Il seed viene consumato una sola volta. Un retry contestuale o una successiva
revalidazione chiama nuovamente `loadStudentLibrary` senza seed e rilegge quindi
il documento autorevole. I replay iniziali di React StrictMode riusano il seed
finché il mount corrente non accetta un risultato, evitando di reintrodurre la
lettura duplicata in sviluppo.

Il cambio di UID viene confrontato durante il render e nasconde sincronicamente
il contesto precedente. Se un retry rileva una nuova classe, Didattica riallinea
anche il controllo della Modalità verifica nel componente padre.

## Sicurezza e comportamento preservati

- le Firestore Rules continuano a verificare identità, classe e assegnazione;
- il listener singolo `settings/studentAccess` resta attivo per la Modalità
  verifica;
- Verifiche, query dei contenuti pubblici e cache delle lezioni non cambiano;
- un `classId` nullo resta fail-closed e non avvia query ai programmi;
- nessuna UI visibile, dipendenza, Function o configurazione è modificata.

## Impatto costi

Per ogni ingresso approvato nel portale studente vengono eliminate due letture
documentali duplicate. Retry e revalidazioni esplicite mantengono invece la
lettura necessaria per non affidarsi indefinitamente allo snapshot iniziale.

## Rollback

Revert della PR e ridistribuzione del solo Hosting DEV.
