# SchoolForge — Strategia di test

**Versione:** 2.2

---

## 1. Obiettivo

I test dimostrano i requisiti della baseline; non servono solo a far passare la build. Ogni pacchetto aggiunge test proporzionati al rischio e non introduce dati reali negli ambienti `dev` o `test`.

---

## 2. Livelli di test

| Livello | Strumento target | Scopo |
|---|---|---|
| Unit | Vitest | Parser `lesson-contract`, selezione domande, punteggi, stati verifica, renderer export (PDF/MD/CSV), funzioni pure. |
| Contract | Fixture Markdown e payload Firestore | Contratto pool v1, errori strutturati, tipi TypeScript di `api-contract.md`. |
| Integration | Firebase Emulator Suite | Security Rules, commit `activeImportId`, transazioni Firestore, gateway `startDigitalAttempt`/`continueDigitalAttempt`, participant lock, reset e snapshot pubblicato. |
| E2E | Playwright | Flussi docente + Portale attraverso browser (include generazione PDF e download). |
| Manuale | Checklist gate | UX, accessibilità, PDF nel browser, backup/restore e costi. |

---

## 3. Fixture obbligatorie

- UDA, lezione e pool validi;
- pool con id duplicato, difficoltà invalida, opzione/soluzione incoerente;
- verifica con minimi impossibili e fonti insufficienti;
- download cartaceo (PDF nel browser) che non crea record di tentativo né accessLog; al più incrementa `downloadCount`;
- tentativo digitale: avvio, bozza, ripresa dopo refresh, consegna;
- secondo avvio digitale con lo stesso nome+cognome sulla stessa verifica (rifiutato: `PARTICIPANT_ALREADY_USED`);
- re-import di una lezione con pool modificato (aggiornamento `questionIndex`);
- import fallito con pool invalido o upload interrotto (l'`activeImportId` e il contenuto visibile restano invariati);
- snapshot pubblicato prima e dopo modifica della lezione sorgente;
- tentativo digitale con cookie assente, scaduto e revocato (rifiutati dal gateway);
- lookup pubblico: `get` con hash del token valido ammesso, `list` dei link e accesso al documento verifica privato rifiutati;
- reset docente di tentativo `in_progress` con motivazione e audit; reset di consegna rifiutato;
- correzione parziale, rettifica ed eliminazione;
- export con consegne definitive, bozza, annullata ed eliminata in tutti e tre i formati;
- output AI valido, incompleto e non autorizzato (M5/V2).

---

## 4. Matrice per gate

| Gate | Test automatici | Test umano |
|---|---|---|
| G1 | Auth owner/non-owner; Security Rules default-deny; Emulator. | Verifica budget ed export Firestore manuale dalle impostazioni. |
| G2 | Parser pool valido/invalido; upload isolato e commit `activeImportId`; rendering sanitizzato; export ZIP; programma svolto MD e PDF; kit e dashboard prontezza. | Import di cartella didattica reale; nessun pool esposto nel rendering. |
| G3 | Stati verifica; PDF generato nel browser; canale cartaceo senza record di tentativo né accessLog (al più `downloadCount`); nessun PDF in Storage. | Download PDF dal browser su mobile e desktop. |
| G4 | Gateway: participant lock nome+cognome, cookie, nessun write Firestore dal portale, snapshot senza soluzioni, log accesso; bozza/ripresa/consegna; reset auditato; consegna immutabile. | Mobile, tastiera, fullscreen/warning; nessuna soluzione visibile a studente. |
| G5 | Percentuale e rettifiche; eliminazione dati; export PDF/MD/CSV da snapshot; consegna modificata lezione. | Revisione documento export nei tre formati; caricamento manuale Drive. |
| G6/G7 (V2) | Contesto AI chiuso; audit; bulk approval; opt-in automatico; C-03 gate. | Revisione didattica e policy. |

---

## 5. Test negativi non negoziabili

1. Un utente Firebase diverso dall'owner non legge o scrive dati docente.
2. Un client portale non legge né scrive direttamente tentativi, risposte o snapshot; le soluzioni non compaiono in alcuna risposta del gateway.
3. Il Portale può ottenere solo `publicVerificationLinks/{hash(token)}` con `get`; non può elencare link né leggere la verifica privata.
4. Un pool invalido non entra nella selezione domande.
5. Una configurazione non valida non viene attivata.
6. Un secondo avvio digitale con lo stesso nome+cognome normalizzati sulla stessa verifica è rifiutato con `PARTICIPANT_ALREADY_USED`; ogni accesso resta tracciato nel Report Accessi.
7. Refresh del Portale non cambia lo snapshot né le risposte in bozza.
8. Dopo consegna digitale, risposte e snapshot non sono modificabili.
9. Un import fallito non cambia l'`activeImportId`; la modifica di un Markdown sorgente non altera verifica pubblicata, export e correzione di una consegna già svolta.
10. Cookie assente, scaduto o revocato non permette ripresa, bozza né consegna; il reset può annullare solo un tentativo in corso e richiede audit.
11. PDF e documenti export non esistono in Storage o Firestore dopo la generazione.
12. AI non riceve soluzioni di altre domande, non usa web e non modifica punteggi senza approvazione o C-03.

---

## 5c. Casi di test su questionIndex e re-import

1. **Re-import di una lezione con pool modificato aggiorna correttamente questionIndex** — dopo il re-import dall'interfaccia, le voci di `questionIndex` riflettono il nuovo pool (aggiunte, rimozioni, valori `difficolta`/`peso`/`maxPoints` aggiornati).
2. **Import fallito non cambia il Programma attivo** — un re-import con pool invalido oppure upload interrotto non aggiorna `activeImportId`; l'import e il `questionIndex` visibili restano invariati.

---

## 5b. Convenzioni, fixture ed esecuzione

### Convenzione di naming

| Pattern | Tipo di test | Strumento |
|---|---|---|
| `*.test.ts` | Unit | Vitest |
| `*.contract.test.ts` | Contract (contratto pool v1, tipi API) | Vitest |
| `*.e2e.ts` | End-to-end | Playwright |

### Fixture — pool valido (Markdown)

Pool minimo valido con tre domande, difficoltà 1–3 e peso 1–3 (scala lineare; punteggio massimo = `difficoltà × peso`):

```md
---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: Quale protocollo risolve i nomi di dominio?
    opzioni:
      - id: a
        testo: DNS
      - id: b
        testo: DHCP
    soluzione: [a]
  - id: q-002
    tipo: aperta
    difficolta: 2
    peso: 2
    testo: |
      Spiega la differenza tra HTTP e HTTPS.
    soluzione: |
      HTTPS aggiunge un canale cifrato con autenticazione del server.
  - id: q-003
    tipo: chiusa_multipla
    difficolta: 3
    peso: 3
    testo: Quali sono livelli del modello TCP/IP?
    opzioni:
      - id: a
        testo: Applicazione
      - id: b
        testo: Trasporto
      - id: c
        testo: Sessione
    soluzione: [a, b]
---
```

### Fixture — pool invalido (campi obbligatori mancanti)

```md
---
schema: schoolforge-pool/v1
questions:
  - id: q-001
    tipo: aperta
    # difficolta mancante
    # peso mancante
    testo: Domanda senza difficoltà né peso.
    # soluzione mancante
---
```

Atteso: il parser rifiuta il pool indicando i campi `difficolta`, `peso` e `soluzione` mancanti per `q-001`. Il pool invalido è interamente escluso dalla selezione.

### Mock Firebase per Vitest

I test di integrazione usano `firebase/app` configurato verso l'Emulator Suite (`connectFirestoreEmulator`, `connectAuthEmulator`, ecc.) con le porte di `toolchain.md`. **Non** si usa `jest-firebase-mock` o mock equivalenti: si testa contro gli emulatori reali per validare anche le Security Rules.

### Come eseguire i test

| Comando | Scopo |
|---|---|
| `pnpm test` | Unit e contract test (Vitest). |
| `pnpm test:integration` | Test contro Firebase Emulator Suite. |
| `pnpm test:e2e` | Test end-to-end (Playwright). |

---

## 6. Pipeline

Ogni PR esegue format, lint, typecheck, unit e contract test. Le PR verso `main` eseguono Emulator Suite (includendo le Security Rules). Prima di ogni gate è obbligatorio E2E del modulo. Test falliti bloccano merge e gate; nessun bypass è ammesso per accelerare il delivery.

---

## 7. Dati, costi e report

Le fixture sono sintetiche. I test Firebase usano emulatori salvo le prove manuali esplicitamente richieste dal gate. Il provider AI usa mock fino a G6 (V2). Ogni run salva risultati, versioni e `requestId` senza contenuti studenti.
