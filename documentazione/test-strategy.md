# SchoolForge — Strategia di test

**Versione:** 2.0

---

## 1. Obiettivo

I test dimostrano i requisiti della baseline; non servono solo a far passare la build. Ogni pacchetto aggiunge test proporzionati al rischio e non introduce dati reali negli ambienti `dev` o `test`.

---

## 2. Livelli di test

| Livello | Strumento target | Scopo |
|---|---|---|
| Unit | Vitest | Parser `lesson-contract`, selezione domande, punteggi, stati verifica, renderer export (PDF/MD/CSV), funzioni pure. |
| Contract | Fixture Markdown e payload Firestore | Contratto pool v1, errori strutturati, tipi TypeScript di `api-contract.md`. |
| Integration | Firebase Emulator Suite | Security Rules, transazioni Firestore (lock email, attivazione verifica), Storage, `startDigitalAttempt` Function. |
| E2E | Playwright | Flussi docente + Portale attraverso browser (include generazione PDF e download). |
| Manuale | Checklist gate | UX, accessibilità, PDF nel browser, backup/restore e costi. |

---

## 3. Fixture obbligatorie

- UDA, lezione e pool validi;
- pool con id duplicato, difficoltà invalida, opzione/soluzione incoerente;
- verifica con minimi impossibili e fonti insufficienti;
- tentativo cartaceo con lock email (download PDF browser);
- tentativo cartaceo concorrente con lo stesso recapito;
- tentativo digitale: avvio, bozza, ripresa dopo refresh, consegna;
- lock inter-canale (stesso recapito usato in canale cartaceo poi digitale);
- snapshot digitale prima e dopo modifica della lezione sorgente;
- correzione parziale, rettifica ed eliminazione;
- export con consegne definitive, bozza, annullata ed eliminata in tutti e tre i formati;
- output AI valido, incompleto e non autorizzato (M5).

---

## 4. Matrice per gate

| Gate | Test automatici | Test umano |
|---|---|---|
| G1 | Auth owner/non-owner; Security Rules default-deny; Emulator. | Verifica budget, backup e restore manuale. |
| G2 | Parser pool valido/invalido; import atomico; rendering sanitizzato; export ZIP; programma svolto MD e PDF. | Import di cartella didattica reale; nessun pool esposto nel rendering. |
| G3 | Stati verifica; PDF generato nel browser; lock email concorrente; nessun PDF in Storage. | Download PDF dal browser su mobile e desktop; lock verificato in Firestore. |
| G4 | `startDigitalAttempt`: token sessione cookie, snapshot senza soluzioni, lock; bozza/ripresa; consegna immutabile. | Mobile, tastiera, fullscreen/warning; nessuna soluzione visibile a studente. |
| G5 | Percentuale e rettifiche; eliminazione dati; export PDF/MD/CSV da snapshot; consegna modificata lezione. | Revisione documento export nei tre formati; caricamento manuale Drive. |
| G6/G7 | Contesto AI chiuso; audit; bulk approval; opt-in automatico; C-02/C-03 gate. | Revisione didattica e policy. |

---

## 5. Test negativi non negoziabili

1. Un utente Firebase diverso dall'owner non legge o scrive dati docente.
2. Un client non legge direttamente `soluzione` dallo snapshot di un tentativo digitale.
3. Un pool invalido non entra nella selezione domande.
4. Una configurazione non valida non viene attivata.
5. Due richieste concorrenti con lo stesso recapito generano un solo lock (un solo download PDF o un solo tentativo digitale).
6. Refresh del Portale non cambia lo snapshot né le risposte in bozza.
7. Dopo consegna digitale, risposte e snapshot non sono modificabili.
8. La modifica di un Markdown sorgente non altera export e correzione di una consegna già svolta.
9. PDF e documenti export non esistono in Storage o Firestore dopo la generazione.
10. AI non riceve soluzioni di altre domande, non usa web e non modifica punteggi senza approvazione o C-03.

---

## 6. Pipeline

Ogni PR esegue format, lint, typecheck, unit e contract test. Le PR verso `main` eseguono Emulator Suite (includendo le Security Rules). Prima di ogni gate è obbligatorio E2E del modulo. Test falliti bloccano merge e gate; nessun bypass è ammesso per accelerare il delivery.

---

## 7. Dati, costi e report

Le fixture sono sintetiche. I test Firebase usano emulatori salvo le prove manuali esplicitamente richieste dal gate. Il provider AI usa mock fino a G6. Ogni run salva risultati, versioni e `requestId` senza contenuti studenti.
