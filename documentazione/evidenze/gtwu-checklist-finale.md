# Gate GTWU — checklist finale Teacher Workflow Upgrades

**Verdetto: Gate GTWU — PASS.**  
**Data:** 22 luglio 2026.  
**Ambiente:** `schoolforge-dev`.  
**URL:** <https://schoolforge-dev.web.app>  
**SHA Hosting finale:** `f1650b4` (include TWU-04B e il fix di compatibilità ZIP
UDA #277).  
**Natura della chiusura:** solo evidenze e allineamento documentale; nessun
nuovo codice, Rule, indice, schema, dipendenza, configurazione o deploy.

## 1. Stato dei pacchetti

| Pacchetto | Stato finale | Contenuto verificato |
|---|---|---|
| TWU-01 | ✅ implementato, distribuito e verificato | Preview picker con ellissi, icone VEX coerenti, refresh consegne, primo/ultimo accesso studente. |
| TWU-02 | ✅ implementato, distribuito e verificato | Preferenze IA owner-only, profili `economy`/`quality`, form condiviso e risoluzione modello/listino server-side fail-closed. |
| TWU-03/03A/03B | ✅ implementato, distribuito e verificato | Visibilità batch, toolbar ordinata, indicatori in tabella, restituzione visibile con soluzioni congelate per default. |
| TWU-04A/04B | ✅ contratto e implementazione completati; smoke DEV superato | Import di una UDA nell'import attivo con staging/lease/commit, export pool round-trip e compatibilità ZIP canonica. |
| CHUNK-RECOVERY-01 | ✅ implementato e verificato | Recovery esplicita dei chunk PDF obsoleti senza reload automatico. |
| CORR-PDF-01 | ✅ implementato, distribuito e verificato | Un PDF archivistico autonomo per studente; ZIP soltanto come contenitore di PDF separati. |

`TWU-05` resta un identificatore riservato per eventuali evoluzioni future: non
contiene requisiti approvati e non blocca questo gate.

## 2. Matrice delle evidenze

Legenda: **A** = evidenza automatica; **M** = conferma manuale realmente
dichiarata dal docente su DEV.

| # | Criterio | Evidenza A | Evidenza M | Esito |
|---|---|---|---|---|
| 1 | Preview domande leggibile, troncamento con ellissi senza perdere il testo | `QuestionPicker.test.tsx` | Verificato nel flusso reale di creazione verifica | PASS |
| 2 | Messaggi VEX con icone semantiche e layout coerente | `VexBuilder.test.tsx` | Verificato su DEV | PASS |
| 3 | Refresh manuale delle consegne senza polling e senza perdere selezione/ordinamento | `VerificationsView.test.tsx` | Verificato su DEV | PASS |
| 4 | Primo e ultimo accesso studente distinti, timestamp server-side e Rules ristrette | `RoleGate.test.tsx`, `studentsService.test.ts`, `StudentsView.test.tsx`, suite Rules TWU-01 | Accessi reali verificati | PASS |
| 5 | Preferenze IA caricate fail-closed e modificabili dal docente | `teacherAiPreferencesService.test.ts`, `AiCorrectionSettingsDialog.test.tsx`, `VerificationsView.test.tsx` | Impostazioni e correzione IA verificate su DEV | PASS |
| 6 | Profilo modello risolto solo server-side, senza fallback silenzioso | test Functions del profilo/configurazione IA e Rules owner-only | Profili `economy`/`quality` verificati | PASS |
| 7 | Azioni batch Completa/Restituisci/Visibilità/Riapri/Azzera coerenti e selezione persistente | `batchCorrectionActions.test.ts`, `batchReturnVisibility.test.ts`, dialog/menu e `VerificationsView.test.tsx` | Flusso batch completo verificato | PASS |
| 8 | Restituzione inizialmente visibile con sole soluzioni congelate autorizzate | `correctionsService.test.ts`, test Rules M4/TWU-03B | Vista docente e studente verificate | PASS |
| 9 | Import UDA reale: validazione, collisioni, staging, commit e cleanup idempotente | `readUdaZip.test.ts`, `validateUdaArchive.test.ts`, `importUdaRepository.test.ts` | Import reale riuscito su DEV | PASS |
| 10 | Compatibilità ZIP: nome esterno canonico e cartella interna senza numero | test reader+validator sul caso `uda-01-lavorare-con-intelligenza-artificiale.zip` | Lo stesso ZIP reale è stato importato correttamente dopo #277 | PASS |
| 11 | UDA importata visibile coerentemente a docente e studente, senza pool/soluzioni lato studente | `committedUdas.test.ts`, `securityReview.test.ts`, suite student didattica | Sidebar, panoramica, conteggi e vista studente verificati | PASS |
| 12 | Export programma ZIP include i pool ed è reimportabile | `exportZip.test.ts` e validatori pool V2 | Export e round-trip verificati | PASS |
| 13 | Collisione e operazioni concorrenti non producono duplicati o pubblicazioni parziali | `importUdaRepository.test.ts`, lease e preflight collisioni | Collisione/doppia operazione verificate | PASS |
| 14 | Import UDA utilizzabile su desktop, mobile e Brave | test dialog/responsive; gateway same-origin già coperto | Smoke desktop/mobile/Brave confermato | PASS |
| 15 | PDF archivistico separato per studente, VEX filtrato e ZIP all-or-nothing | `correctionArchiveModel/Pdf/Export` e `CorrectionArchiveExportDialog` | PDF singolo e selezione multipla verificati | PASS |
| 16 | PDF chiuse leggibile: checkbox vettoriali, opzioni complete e soluzioni multiple in elenco | test modello/renderer PDF | Output PDF verificato dal docente | PASS |
| 17 | Nessun costo passivo aggiunto | assenza di nuovi listener/polling; test dei service e cost model documentato | Nessuna anomalia operativa osservata | PASS |

## 3. Baseline automatica

- TWU-04B prima del merge: suite web completa **1807/1807**, format, lint,
  typecheck e build web/Functions verdi.
- Fix ZIP #277: test reader/validatore finali **36/36**; suite web completa e
  build verdi in CI. Il test esatto del pacchetto reale è incluso.
- Ultima suite Rules rilevante: **516/516**; TWU-04B e #277 non modificano le
  Rules.
- TWU-02: suite Functions **552/552** e test web/Rules del pacchetto verdi.
- Nessuna nuova dipendenza, Function, Rule, Storage Rule o indice introdotti da
  TWU-03/04B/CORR-PDF-01.

## 4. Rollout DEV

Rollout conclusivo eseguito soltanto su `schoolforge-dev` con Node.js
`v22.23.1`:

1. Hosting `e3d7334` — include #275 (PDF soluzioni multiple) e #276 (TWU-04B);
2. Hosting `f1650b4` — include #277, compatibilità del nome ZIP UDA reale.

Build e `git diff --check` erano verdi prima dei deploy. Functions, Firestore
Rules, Storage Rules, indici e PROD non sono stati toccati in questi due
rollout.

## 5. Conferma manuale utilizzata

La chiusura usa esclusivamente la conferma data dal docente dopo la checklist
di smoke DEV: «niente da fare! tutto perfetto! tutto ma tutto perfetto». La
conferma copre il flusso TWU completo elencato nella matrice, incluso Importa
UDA sul pacchetto reale, visibilità docente/studente, export/round-trip,
collisioni, responsive/Brave e PDF delle correzioni.

Non viene attribuita alcuna verifica PROD.

## 6. Limiti residui accettati

- Firestore e Storage non condividono una transazione globale: TWU-04B usa
  staging invisibile, manifest e cleanup idempotente.
- Le azioni batch tra consegne non sono atomicamente globali: gli errori sono
  isolati e riepilogati per riga.
- L'import grande usa più chiamate gateway, ma resta entro i limiti congelati
  e non introduce costi passivi.
- Il PDF della singola lezione è fuori da CORR-PDF-01 e da GTWU; il relativo
  problema resta un backlog separato e non blocca l'archivio correzioni.
- `TWU-05` non ha scope approvato ed è soltanto riservato.

## 7. Verdetto

Tutti i criteri approvati del pacchetto TWU dispongono di evidenza automatica e
di conferma manuale DEV adeguata. Non risultano gap funzionali, di sicurezza o
di costo bloccanti.

**Gate GTWU — PASS.**

Il PASS riguarda `schoolforge-dev` e non autorizza alcun rollout PROD.
