# SchoolForge — Strategia di test

**Versione:** 3.2

## 1. Obiettivo

I test dimostrano i requisiti della baseline; non servono solo a far passare la build. Ogni pacchetto del piano aggiunge test proporzionati al rischio e non introduce dati reali negli ambienti `dev` o `test`.

## 2. Livelli di test

| Livello | Strumento target | Scopo |
|---|---|---|
| Unit | Vitest | Parser, selezione, punteggi, stati, renderer e funzioni pure. |
| Contract | Fixture Markdown e payload API | Contratto pool v1, errori strutturati e proiezioni pubbliche. |
| Integration | Firebase Emulator Suite | Auth, Rules, Firestore, Storage, Functions e transazioni. |
| E2E | Playwright | Flussi docente/Portale attraverso browser. |
| Manuale | Checklist gate | UX, accessibilità, PDF/email reali, backup/restore e costi. |

## 3. Fixture obbligatorie

- manifesto Programma, UDA, lezione e pool validi;
- manifesto con ID duplicato, file mancante, path traversal e asset non ammesso;
- pool con id duplicato, difficoltà invalida, opzione/soluzione incoerente;
- verifica con minimi impossibili e fonti insufficienti;
- vettori deterministici per `schoolforge-selection/v1`, inclusi minimi per difficoltà e nessuna domanda duplicata;
- tentativo cartaceo e digitale con lo stesso nome/cognome e email differenti;
- snapshot pubblicato e snapshot digitale prima e dopo modifica della lezione sorgente;
- risposta aperta oltre limite, risposta chiusa con opzione estranea e punteggi in centesimi ai limiti di arrotondamento;
- tentativo annullato con e senza rilascio esplicito del lock;
- correzione parziale, rettifica ed eliminazione;
- export con consegne definitive, bozza, annullata ed eliminata;
- output AI valido, incompleto e non autorizzato.

## 4. Matrice per gate

| Gate | Test automatici | Test umano |
|---|---|---|
| G1 | Auth owner/non-owner, Rules default-deny, emulatori. | Verifica budget, backup e restore. |
| G2 | Parser manifesto, import a visibilità atomica, rendering sanitizzato, export ZIP e dashboard prontezza. | Import di cartella didattica reale senza pool esposto. |
| G3 | Stati verifica, snapshot pubblicato, PDF stream, lock nome/cognome concorrente, MailGateway mock. | Invio a recapito di test e controllo nessun PDF persistito. |
| G4 | Token Portale, snapshot, bozza/ripresa, annullamento/reset e consegna immutabile. | Mobile, tastiera, fullscreen/warning e assenza soluzioni. |
| G5 | Percentuale, rettifiche, eliminazione, export globale da snapshot. | Revisione documento export e caricamento manuale Drive. |
| G6/G7 | Contesto AI chiuso, audit, bulk approval, opt-in automatico. | Revisione didattica e policy C-02/C-03. |

## 5. Test negativi non negoziabili

1. Un utente Firebase diverso dall'owner non legge o scrive dati.
2. Un client non legge direttamente soluzioni, correzioni o audit.
3. Un pool invalido non entra nella selezione.
4. Una configurazione non valida non viene attivata.
5. Due richieste concorrenti con lo stesso nome/cognome generano un solo tentativo anche con email differenti.
6. Refresh del Portale non cambia lo snapshot e una modifica della lezione non altera il snapshot pubblicato.
7. Dopo consegna, risposte e snapshot non sono modificabili.
8. Una modifica del Markdown non altera export/correzione di una consegna svolta.
9. PDF ed export non esistono in Storage dopo la risposta HTTP/email.
10. L'annullamento non rilascia il lock senza richiesta docente esplicita; il token di ripresa è invalidato.
11. AI non riceve web/retrieval e non modifica punteggi senza approvazione o C-03.

## 6. Pipeline

Ogni PR esegue format, lint, typecheck, unit e contract test. Le PR verso `main` eseguono Emulator Suite. Prima di ogni gate è obbligatorio E2E del modulo. I test falliti bloccano merge e gate; non sono ammessi bypass per accelerare il delivery.

## 7. Dati, costi e report

Le fixture sono sintetiche. Il test email usa un destinatario/ambiente controllato; il provider AI usa mock fino a G6. Ogni run salva risultati, versioni e `requestId` senza contenuti studenti. I test Firebase usano emulatori salvo le prove manuali esplicitamente richieste dal gate.
