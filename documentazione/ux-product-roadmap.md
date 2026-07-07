# UX/Product Polish — Roadmap

**Versione:** 1.0
**Data:** 2026-07-07
**Stato MVP:** funzionante su https://schoolforge-dev.web.app (DEV SMOKE PASS)

---

## Stato attuale

L'MVP docente cartaceo è tecnicamente completo e funzionante. L'interfaccia è ancora grezza: struttura tecnica, navigazione non intuitiva, feedback visivo minimale, nessun tema coerente. Il prodotto è usabile da chi lo ha costruito, ma non da un docente che lo scopre per la prima volta.

**Limiti UX noti prima di questa fase:**

- "Classi" è nascosta sotto "Impostazioni" — non trovabile.
- Nessuna sezione dedicata alle lezioni.
- Il picker domande è una lista flat senza filtri.
- Form e layout non ottimizzati per schermi reali.
- Nessun tema visivo coerente.
- Verifiche chiuse non eliminabili.
- Nessun feedback di stato durante le operazioni lunghe.

---

## Principi guida

1. **Minimalismo operativo.** Ogni elemento UI deve guadagnarsi il suo posto. Nessun componente aggiunto per abitudine o completezza percepita.
2. **Chiarezza per il docente.** L'utente è un solo docente. Non ci sono ruoli, permessi complessi o workflow multi-step. L'interfaccia deve riflettere questa semplicità.
3. **Basso costo tecnico e di manutenzione.** CSS modules già presenti. Nessuna libreria UI esterna. Nessun design system di terze parti.
4. **Nessun gonfiamento del prodotto.** UX polish non significa aggiungere feature. Significa rendere le feature esistenti più chiare e usabili.
5. **Accessibilità base.** Contrasto sufficiente, label su tutti gli input, stato focus visibile, ARIA minimale dove necessario.
6. **Responsive minimo.** Il docente lavora su desktop. Tablet accettabile. Mobile non prioritario per V1.

---

## Classificazione problemi

### P0 — Bug o blocchi usabilità

| ID | Problema | Note |
|---|---|---|
| P0-01 | "Classi" irraggiungibile senza sapere che è sotto "Impostazioni" | Fix in UX-01 |
| P0-02 | Nessun feedback visivo durante import ZIP lungo | Fix in UX-02 |
| P0-03 | Verifiche chiuse non eliminabili — lista cresce senza fine | Fix in UX-04 |

### P1 — UX ad alto impatto

| ID | Problema | Note |
|---|---|---|
| P1-01 | Navigazione laterale non rispecchia il workflow docente | Fix in UX-01 |
| P1-02 | Nessuna sezione lezioni accessibile direttamente | Fix in UX-03 |
| P1-03 | Question picker senza filtri — difficile su pool grandi | Fix in UX-05 |
| P1-04 | Form creazione verifica: label e spaziatura migliorabili | Fix in UX-04 |

### P2 — Polish grafico

| ID | Problema | Note |
|---|---|---|
| P2-01 | Nessun tema coerente — aspetto da prototipo | Fix in UX-06 |
| P2-02 | Badge stato verifica (BOZZA/ATTIVA/CHIUSA) non prominenti | Fix in UX-04 |
| P2-03 | Template kit visivamente anonimo | Fix in UX-01 |

### Backlog post-MVP

- Shortcut tastiera per azioni frequenti.
- Drag & drop per ordinare le domande in verifica.
- Anteprima PDF inline prima del download.
- Filtri avanzati nel question picker (per lezione, difficoltà, tipo).

---

## Roadmap PR

---

### UX-01 — Shell, navigazione, header, Template, Classi

**Obiettivo:** Rendere la navigazione comprensibile al primo avvio. Portare "Classi" in una voce di menu dedicata. Riorganizzare la barra laterale nell'ordine del workflow docente.

**Modifiche incluse:**

- `TeacherShell.tsx`: rinominare/riordinare le voci nav → `Programmi` | `Lezioni` (nuova) | `Verifiche` | `Classi` | `Impostazioni`.
- `ClassesView.tsx`: spostata da `impostazioni` a voce dedicata `classi`.
- Header: aggiungere nome app e indicatore utente autenticato.
- `TemplateKitView.tsx`: migliorare copy e layout del kit template scaricabili.
- CSS modules: pulizia spaziatura e font coerenti nelle sezioni toccate.

**Modifiche escluse:**

- Nessuna nuova feature.
- Impostazioni: restano le impostazioni esistenti (se presenti), senza "Classi".
- Nessun cambio al modello dati.

**Rischi:**

- Test che fanno riferimento alla struttura di navigazione potrebbero rompersi se cercano testo specifico delle voci.
- Spostare ClassesView richiede aggiornare il routing interno in TeacherShell.

**Test richiesti:**

- `pnpm test` — verificare che nessun test di navigazione si rompa.
- Smoke manuale: tutte le sezioni raggiungibili, ClassesView funzionante nella nuova posizione.

**Criteri di accettazione:**

- [ ] "Classi" è raggiungibile con un click dalla barra laterale.
- [ ] L'ordine delle voci nav rispecchia il workflow: Programmi → Lezioni → Verifiche → Classi → Impostazioni.
- [ ] Nessuna regressione sui test automatici (197/197).

---

### UX-02 — Programmi: struttura, import guidato, feedback

**Obiettivo:** Rendere il pannello Programmi più chiaro e dare feedback visivo durante l'import ZIP.

**Modifiche incluse:**

- `ProgramsView.tsx`: layout a due colonne (lista programmi | dettaglio) più esplicito.
- Import ZIP: spinner o messaggio "Importazione in corso…" durante il processo.
- Messaggio errore import: più leggibile, con indicazione del file e campo errato.
- Dashboard prontezza: revisione copy e icone stato.
- Bottone "Importa ZIP" disabilitato + tooltip se nessun programma selezionato.

**Modifiche escluse:**

- Nessuna modifica alla logica di import (`importRepository`, `readZipFile`).
- Nessuna modifica alle Security Rules.
- Nessun cambio al formato ZIP.

**Rischi:**

- Il feedback asincrono richiede gestione stato; rischio di loop se lo stato `importing` non viene resettato correttamente su errore.

**Test richiesti:**

- Test unitari esistenti su `readZipFile` e `importRepository` devono restare verdi.
- Smoke manuale: import valido → messaggio successo; import non valido → errore leggibile.

**Criteri di accettazione:**

- [ ] Durante import ZIP è visibile un indicatore di progresso.
- [ ] Errori di validazione mostrano file e campo specifico in modo leggibile.
- [ ] Dashboard prontezza mostra stato corretto dopo import.

---

### UX-03 — Nuova sezione Lezioni

**Obiettivo:** Dare al docente accesso diretto alle lezioni importate, con possibilità di leggere il contenuto senza navigare nel pannello programmi.

**Modifiche incluse:**

- Nuova voce nav `Lezioni` in TeacherShell.
- `LessonsView.tsx` (nuovo): lista lezioni per programma selezionato, con click per aprire contenuto Markdown.
- Rendering Markdown: usare libreria già presente o soluzione minimale (no nuove dipendenze pesanti).
- Filtro per programma/UDA nella vista lezioni.

**Modifiche escluse:**

- Nessuna modifica al modello dati delle lezioni.
- Nessuna funzione di editing lezioni.
- Nessun upload diretto di singole lezioni (solo via ZIP).

**Rischi:**

- Aggiungere una libreria Markdown se non già presente aumenta il bundle size.
- `fetchLessonContent` è già implementato; la nuova vista la usa — nessun rischio lato Storage.

**Test richiesti:**

- Unit test per `LessonsView` (rendering lista, stato vuoto, errore caricamento).
- Smoke manuale: lezione aperta, contenuto Markdown leggibile.

**Criteri di accettazione:**

- [ ] Il docente può aprire una lezione e leggerne il contenuto da una sezione dedicata.
- [ ] Se nessun programma selezionato: messaggio stato vuoto.
- [ ] Errore caricamento lezione: messaggio leggibile, nessun loop infinito.

---

### UX-04 — Verifiche: layout tabellare, badge stato, eliminazione chiuse

**Obiettivo:** Rendere la lista verifiche leggibile e permettere l'eliminazione delle verifiche chiuse per tenere la lista pulita.

**Modifiche incluse:**

- `VerificationsView.tsx`: lista verifiche in formato tabella o card con badge stato prominente (BOZZA / ATTIVA / CHIUSA).
- Eliminazione verifica: **solo per stato `closed`**. Bottone "Elimina" visibile solo se `status === 'closed'`.
- Conferma eliminazione: dialog modale o inline confirm prima di procedere.
- `verificationsService`: aggiungere funzione `deleteVerification(id)` che verifica lato client che lo stato sia `closed` prima di eliminare.
- Form creazione verifica: migliorare label, spaziatura, ordine campi.

**Modifiche escluse:**

- Verifiche `active` non eliminabili — sono snapshot immutabili attivi.
- Verifiche `draft`: la possibilità di eliminarle sarà valutata separatamente (rischio perdita dati non intenzionale); **non inclusa in UX-04**.
- Nessuna modifica alle Security Rules (l'eliminazione è già consentita al docente owner).
- Nessuna modifica al modello snapshot (`VerificationTeacherSnapshot`).

**Rischi:**

- L'eliminazione di una verifica chiusa è irreversibile. Il confirm modale è obbligatorio.
- Se in futuro si aggiunge correzione risultati (M4), le verifiche chiuse potrebbero avere risultati associati. L'eliminazione va gestita con cascata o blocco — da valutare in M4, non qui.

**Test richiesti:**

- Unit test: `deleteVerification` rifiuta se status ≠ `closed`.
- Unit test: bottone "Elimina" presente solo per `closed`, assente per `active` e `draft`.
- Smoke manuale: verifica chiusa eliminata → sparisce dalla lista; verifica attiva → nessun bottone elimina.

**Criteri di accettazione:**

- [ ] Verifiche `closed` eliminabili con conferma esplicita.
- [ ] Verifiche `active` non eliminabili (nessun bottone visibile).
- [ ] Verifiche `draft` non eliminabili in questa PR (rimandato).
- [ ] Badge stato prominente e leggibile per tutti gli stati.
- [ ] Nessuna regressione su attivazione verifica e download PDF.

---

### UX-05 — Question picker avanzato (minimale)

**Obiettivo:** Rendere la selezione domande usabile su pool di medie dimensioni senza aggiungere complessità eccessiva.

**Modifiche incluse:**

- Filtro per tipo domanda (aperta / chiusa_singola).
- Filtro per difficoltà (1–3 o range presente nel pool).
- Filtro per UDA/lezione di provenienza.
- Contatore domande selezionate e punteggio totale visibili in tempo reale.
- Selezione/deseleziona tutto (filtered).

**Modifiche escluse:**

- Nessun drag & drop per ordinare le domande (backlog).
- Nessuna anteprima PDF inline.
- Nessuna modifica al modello `questionIndex`.
- Nessun cambio al formato snapshot.

**Rischi:**

- Filtri lato client su `questionIndex` già caricato: nessun impatto su Storage/Firestore.
- Rischio UX: troppi filtri rendono la UI più complessa del necessario. Mantenere i filtri collassabili o in un banner compatto.

**Test richiesti:**

- Unit test: filtri restituiscono il sottoinsieme corretto di domande.
- Smoke manuale: filtro per tipo → lista aggiornata; punteggio totale aggiornato in tempo reale.

**Criteri di accettazione:**

- [ ] Il docente può filtrare domande per tipo, difficoltà e lezione.
- [ ] Il punteggio totale delle domande selezionate è visibile in tempo reale.
- [ ] La selezione funziona correttamente con filtri attivi (nessuna domanda fantasma).

---

### UX-06 — Tema cyber-professional

**Obiettivo:** Dare a SchoolForge un'identità visiva coerente, professionale e leggibile. Non un redesign completo: un tema CSS applicato a tutti i componenti esistenti.

**Modifiche incluse:**

- Variabili CSS globali: palette colori (dark base, accent tecnico), tipografia, spacing scale, border-radius.
- Applicazione del tema a tutti i CSS modules esistenti.
- Modalità dark come default (schermi docente tipicamente usati in ambienti scolastici con luce mista).
- Modalità light come fallback (`prefers-color-scheme`).
- Badge stato verifica con colori semantici (BOZZA: grigio, ATTIVA: verde, CHIUSA: arancio/rosso).
- Favicon e `<title>` aggiornati.

**Modifiche escluse:**

- Nessuna libreria UI esterna.
- Nessun cambio alla struttura dei componenti.
- Nessuna animazione complessa.

**Rischi:**

- Variabili CSS mal applicate possono rompere il contrasto su alcuni componenti — test visivo manuale su ogni sezione obbligatorio.
- Cambio del colore di sfondo può impattare la leggibilità dei messaggi di errore se non aggiornati.

**Test richiesti:**

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — nessuna regressione attesa (CSS non coperto da unit test).
- Smoke visivo manuale: tutte le sezioni, tutti gli stati (loading, error, empty, populated), light e dark mode.

**Criteri di accettazione:**

- [ ] Palette colori coerente in tutta l'app.
- [ ] Contrasto testo/sfondo ≥ 4.5:1 (WCAG AA) sulle sezioni principali.
- [ ] Dark mode funzionante come default; light mode come fallback.
- [ ] Nessuna regressione funzionale.

---

## Ordine di implementazione consigliato

```
UX-01 → UX-02 → UX-03 → UX-04 → UX-05 → UX-06
```

Ogni milestone è indipendente e deployabile separatamente su DEV. UX-06 va per ultima perché tocca tutti i componenti.

---

## Fuori scope di questa fase

- M3 — Portale digitale studenti.
- M4 — Correzione ed export risultati.
- M5 — Correzione AI.
- Cloud Functions nuove.
- Deploy produzione.
- Link pubblici per verifiche.
- Salvataggio PDF su Storage.
