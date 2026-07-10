# Checklist finale V1 — stabilizzazione

**Versione:** 1.0
**Ambito:** l'intera V1 — M1 (Repository didattico), M2 (Verifiche e cartaceo), M3-lite (Portale studente), RE (Repository Editor). M3-full, M4 e M5 non fanno parte di questo ambito (specifica rinviata/fuori scope).
**Scopo:** sintesi di chiusura dopo RE-00 → RE-07. Non duplica le checklist di area già esistenti (elencate in §1): le referenzia. Aggiunge un giro rapido sulle 6 aree UI principali richieste per la stabilizzazione V1 (§2) e il backlog residuo emerso dall'audit di questa sessione (§3–§4).
**Metodo:** come le checklist di area che referenzia, è un audit di codice/documentazione eseguito in questa sessione (nessun browser interattivo collegato a un progetto Firebase reale). §2 resta un template da eseguire manualmente; §3–§4 sono invece esito diretto di questa sessione, non da eseguire.

## 1. Checklist di area già esistenti (referenziate, non duplicate)

| Area | Checklist di dettaglio | Stato noto |
|---|---|---|
| MVP docente cartaceo (M1+M2, locale con emulatori) | [smoke-mvp-docente-cartaceo.md](smoke-mvp-docente-cartaceo.md) | Ripetibile, da eseguire a ogni regressione sospetta |
| Deploy DEV reale (Firebase, non emulatori) | [smoke-dev-deploy.md](smoke-dev-deploy.md) | **DEV SMOKE PASS** (ultima esecuzione registrata) |
| Portale studente M3-lite (gate G4-lite, 6 criteri minimi) | [g4-lite-checklist-manuale.md](g4-lite-checklist-manuale.md) | Template pronto, non eseguito con login Google reale in sessione agente |
| Storage Rules — hardening classe/approvazione | [checklist-dev-post-hardening.md](checklist-dev-post-hardening.md) | Eseguita al momento del hardening Storage Rules |
| Repository Editor (RE-07, gate GRE) | [repository-editor-checklist-manuale.md](repository-editor-checklist-manuale.md) | Template pronto, non eseguito con browser reale in sessione agente |

## 2. Giro rapido sulle 6 aree UI principali (V1 stabilization)

Da eseguire su DEV (https://schoolforge-dev.web.app) o in locale con emulatori. Ogni riga è un controllo di sanità rapido, non una checklist esaustiva — per il dettaglio di ciascuna area vedi §1 o le sezioni specifiche di `mvp-docente-cartaceo.md`.

| # | Area | Cosa verificare | Esito atteso | Risultato |
|---|---|---|---|---|
| 1 | Login | Login docente con "Accedi con Google"; al primo avvio compare "Inizializza SchoolForge" → "Diventa proprietario"; login studente con lo stesso bottone Google, nessun campo email/password in nessuna schermata | Ruolo (TeacherShell/StudentShell) risolto correttamente in base a `ownerUid`; nessun accesso anonimo; nessun errore console al primo caricamento | ⬜ da eseguire |
| 2 | Lezioni | Espandi corso→UDA→lezione; crea UDA/lezione; modifica metadata/corpo; riordina (↕); elimina lezione libera | Sidebar si aggiorna senza refetch dopo ogni azione; nessun errore console | ⬜ da eseguire |
| 3 | Corsi | Crea programma; "Importa ZIP"; "Esporta ZIP"; pannello "Classi"; "Elimina corso" | Import/export coerenti; eliminazione bloccata se esistono verifiche collegate al programma | ⬜ da eseguire |
| 4 | Verifiche | "Nuova verifica"; seleziona domande dal pool; attiva; pubblica/nascondi allo studente; "Scarica PDF studenti"/"soluzioni"; chiudi/elimina | PDF studenti senza soluzioni; verifica `attiva` non eliminabile direttamente (va chiusa prima); nessun errore console | ⬜ da eseguire |
| 5 | Classi | Crea classe; "Modifica"; "Elimina" (con conferma) | Nessuna azione distruttiva senza il riquadro di conferma; lista aggiornata subito dopo ogni azione | ⬜ da eseguire |
| 6 | Studenti | Toggle "Portale studenti"/"Nuove richieste"; Approva/Blocca/Rimetti in attesa/Rimuovi; assegna classe dal menu a discesa | Badge "in attesa" nella nav di TeacherShell coerente col numero di studenti `pending`; nessuna azione senza conferma per la rimozione | ⬜ da eseguire |

## 3. Incoerenze documentali trovate e corrette in questa sessione

Nessun bug di codice trovato nelle 6 aree UI (review statica: nessun `TODO`/`FIXME`, nessun `console.log`/`alert()` residuo, nessun catch silenzioso senza feedback utente). Le uniche incoerenze trovate erano documentali:

1. `documentazione/mvp-docente-cartaceo.md` §"Login docente" descriveva ancora un login email/password nella schermata di login — la UI attuale (`LoginPage.tsx`) ha da tempo un solo bottone "Accedi con Google" (`signInWithPopup`). Corretto per descrivere il flusso reale, incluso come funziona contro l'Auth Emulator (selettore di account fittizio).
2. Stessa pagina, tabella "Limiti noti prima del deploy in produzione": riportava ancora "la voce Classi è sotto Impostazioni nella navigazione" come limite UX aperto — `TeacherShell.tsx` ha già "Classi" come voce di navigazione di primo livello (non annidata). Riga rimossa perché non più vera.
3. `documentazione/api-contract.md` e `documentazione/sicurezza.md`: l'intestazione **Stato** di entrambi i documenti diceva ancora, rispettivamente, "contratto pre-implementazione" e "requisiti da implementare nei pacchetti F-04 e successivi" — risalenti a prima che qualunque modulo fosse implementato. Aggiornate per riflettere che M1/M2/M3-lite/RE sono in vigore.
4. `documentazione/brief.md`: una frase residua diceva che la modifica dei Markdown da portale "è pianificata separatamente nella fase RE" — corretta in "implementato" (Repository Editor completo da RE-07).

Nessun'altra incoerenza "RE ancora futura/pianificata" trovata oltre a queste (le occorrenze verificate ma **non** modificate — `decisioni.md` D-14, la riga "Autorizza" di G4-lite in `piano-implementazione.md` — descrivono correttamente una decisione/gate storici, non lo stato attuale di RE).

## 4. Backlog residuo (non implementato in questa sessione)

Nessun problema bloccante trovato. Un solo elemento di pulizia a basso rischio, segnalato ma non toccato per restare entro "nessuna modifica invasiva":

- **Codice morto in `apps/web/src/lib/auth.tsx`**: `AuthContextValue.signIn` (email/password, `signInWithEmailAndPassword`) è definito ed esposto dal context ma nessun componente lo chiama — `LoginPage.tsx` usa solo `signInWithGoogle`. Probabile residuo di un flusso di login precedente a M3-lite (quando l'autenticazione è stata unificata su Google per docente e studente). Rimuoverlo è sicuro (nessun consumatore) ma tocca la shape pubblica di `AuthContextValue`, quindi non è stato incluso come "fix piccolo e sicuro" in questa sessione — da valutare in un pacchetto di pulizia dedicato, non urgente.
- Le checklist manuali con browser reale (§1: G4-lite, Repository Editor) restano da eseguire da un umano con un progetto Firebase reale — nessun agente in questa sessione ha avuto un browser interattivo collegato a un progetto Firebase con login Google reale.
- Limite già noto e accettato, non nuovo: l'export ZIP non riscrive `programma.md`/`programmaMeta` (annotato in RE-06/RE-07, non ripetuto qui).

## 5. Esito

Nessuna nuova macro-feature introdotta, nessuna modifica invasiva, nessun deploy. La V1 (M1 + M2 + M3-lite + RE) resta considerata stabile per uso DEV/manuale; le sole modifiche di questa sessione sono correzioni documentali di piccola entità (§3) e questa checklist di sintesi.
