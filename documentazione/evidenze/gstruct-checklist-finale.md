# Gate GSTRUCT — checklist finale

**Stato finale:** **PASS — 15 agosto 2026.**

## Esito sintetico

L'importazione append-only degli scheletri UDA e lezione è implementata,
distribuita e provata su DEV. Il formato semplice SchoolForge è la superficie
principale; il percorso YAML versionato resta compatibile e passa dagli stessi
normalizzatori e planner.

## Matrice del gate

| Criterio | Esito | Evidenza |
|---|---|---|
| Import UDA senza contenuto | PASS | Azione reale da corso, preview e append atomico; parser/planner/runtime coperti dalle suite STRUCTURE-IMPORT. |
| Import lezioni senza contenuto | PASS | Import reale eseguito dal docente su più lezioni; metadati conservati come array distinti e verificati nella scheda Informazioni. |
| Append senza overwrite | PASS | Planner e preflight bloccano titoli, document id e Storage path già occupati; nessuna rinomina o merge silenzioso. |
| Retry e risposta persa | PASS | `sourceHash` + `manifestHash`, attempt record, replay committed e recovery `cleanup_pending` coperti dai test end-to-end dei runtime 02A/02B. |
| Collisione e race | PASS | Lease di corso/UDA, rinnovo condizionato e commit fail-closed; test con lease scaduta, tentativo sostituito e mutazione concorrente. |
| Generazione IA dallo scheletro | PASS | Il docente ha generato lezioni reali a partire dai metadati importati; titolo, difficoltà, concetti, obiettivi e contesto UDA entrano nel payload senza nuove letture. |
| Nessuna card vuota allo studente | PASS | Le proiezioni con `content` vuoto sono filtrate; test della vista studente e smoke responsive. |
| Responsive/mobile | PASS | Dialog reali misurati a 1440/1024/390/320 px: nessun overflow, textarea e footer raggiungibili. |
| Compatibilità browser | PASS | Il flusso usa API standard già adottate dal portale; shell/menu/dialog e import contestuale sono stati verificati nel percorso Brave/mobile del gate GTWU e non introducono API browser specifiche ulteriori. |
| Costi passivi | PASS | Zero listener, polling o letture per card; Firebase viene usato soltanto dopo la conferma esplicita dell'import. |

## Invarianti confermate

- nessun contenuto Markdown, pool, domanda o soluzione viene importato;
- un errore blocca l'intero file/testo: nessun risultato parziale;
- gli scheletri vengono aggiunti in coda e non modificano UDA o lezioni
  esistenti;
- l'owner autorevole proviene dal documento programma, non dal client;
- cleanup limitato ai path dimostrati dal manifest dello stesso tentativo;
- nessuna Function, Rule o indice dedicato è stato necessario.

## Verdetto

**Gate GSTRUCT superato (PASS).** Non restano fasi STRUCTURE-IMPORT aperte. Il
PASS riguarda DEV e non autorizza migrazioni o deploy PROD.
