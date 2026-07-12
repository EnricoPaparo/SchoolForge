# Didattica — Roadmap UX (DUX)

**Versione:** 1.0
**Stato:** DUX-00 — specifica approvata, prototipo statico allegato. **Nessuna implementazione applicativa.**
**Dipendenze:** nessuna dipendenza tecnica da M4 (M4-03/M4-04 continuano in parallelo); riusa esclusivamente backend/service/dati già esistenti di RE (Repository Editor) e QE (Question Editor).

---

## 1. Problema attuale

Il docente lavora oggi su tre sezioni separate del `TeacherShell` che sono in realtà tre viste diverse sullo **stesso corso**:

- **Corsi** (`ProgramsView`) — creazione/import ZIP/export/visibilità classi/programma svolto, con un albero corso→UDA→lezione minimale solo per completamento/metadata UDA.
- **Lezioni** (`LessonsView`) — stesso albero corso→UDA→lezione, riproposto da zero, per leggere/modificare contenuto Markdown e front matter della lezione.
- **Domande** (`DomandeView`) — di nuovo lo stesso albero corso→UDA→lezione, riproposto una terza volta, per editare il pool di domande della lezione.

Conseguenze concrete, verificabili nel codice attuale:

- Lo stesso albero di navigazione (programma → UDA → lezione) è implementato e mantenuto **tre volte**, con tre stati di espansione (`expandedCourses`/`expandedUdas`) indipendenti — aprire una lezione in "Lezioni" non lascia alcuna traccia se il docente passa a "Domande" per la stessa lezione.
- Non esiste un concetto di "sto lavorando su questo corso": il docente deve ricostruire il contesto (quale UDA, quale lezione) da capo a ogni cambio di tab.
- La sezione "Classi" è una voce di primo livello del tutto scollegata da "Studenti", pur essendo dati strettamente correlati (assegnazione classe↔studente).
- Il tema visivo attuale (header con motivo diagonale a gradiente) non comunica la sobrietà "Markdown-first, professionale" voluta dal brief.
- Non c'è alcuna landing che dia al docente una visione d'insieme dei propri corsi (quanti UDA, quante lezioni svolte, quante domande) senza aprire ed espandere manualmente ogni albero.

**Didattica** unifica queste tre sezioni in un unico ambiente: una libreria di corsi come landing, e un workspace per-corso con un'unica sidebar UDA/lezioni condivisa da contenuto, domande e informazioni.

## 2. Obiettivi

1. Un solo punto d'ingresso (`Didattica`) per tutto ciò che riguarda un corso: struttura, contenuto lezioni, domande.
2. Un solo albero di navigazione UDA/lezioni per corso, riusato da tutte e tre le schede (Contenuto/Domande/Informazioni), non tre alberi indipendenti.
3. Una landing "libreria" che dia visibilità immediata sullo stato di avanzamento di ogni corso, senza dover espandere nulla.
4. Nessuna perdita di funzionalità rispetto a Corsi/Lezioni/Domande attuali — solo riorganizzazione della navigazione attorno agli stessi service/dati.
5. Classi integrata in Studenti (dati correlati, sezione unica con tab).
6. Migrazione incrementale e reversibile: ogni fase DUX-0x lascia l'app in uno stato funzionante e testato, mai un "big bang".
7. Nessun impatto su costi Firebase, Security Rules o UX studente.

## 3. Architettura informativa

```
TeacherShell (nav di primo livello)
├── Didattica            ← NUOVO — assorbe Corsi + Lezioni + Domande
│    └── Libreria corsi (landing)
│         └── Workspace corso
│              ├── Selezione UDA
│              │    └── Selezione lezione
│              │         ├── scheda Contenuto
│              │         ├── scheda Domande
│              │         └── scheda Informazioni
├── Verifiche            (invariato)
├── Studenti              ← assorbe Classi come tab
│    ├── tab Studenti
│    └── tab Classi
└── Template              (voce autonoma temporanea, ripulita in DUX-05)
```

Corsi/Lezioni/Domande **non spariscono immediatamente**: la migrazione (§16) è a fasi, e ogni fase è un pacchetto DUX-0x separato, dietro le stesse guardie architetturali già in vigore per RE/QE (nessuna nuova Cloud Function, nessuna Security Rule più permissiva, dati letti dagli stessi service `programsService`/`lessonsService`/`questionsService`/`udaService`).

## 4. Navigazione desktop

Tre livelli di profondità, mai di più:

1. **Libreria** (`Didattica` cliccata dalla nav) — griglia di card corso.
2. **Workspace corso** (click su una card) — intestazione corso + sidebar (UDA/lezioni) + area contenuto principale. La sidebar è sempre visibile su desktop, non collassabile (a differenza dell'attuale `LessonsView`/`DomandeView`, dove il collapse esiste solo per compattare l'albero, non per nasconderlo strutturalmente — in Didattica la sidebar resta un pannello fisso di layout).
3. **Dettaglio** all'interno del workspace: selezione UDA (tabella lezioni) o selezione lezione (schede Contenuto/Domande/Informazioni). Questo terzo livello vive nell'area contenuto principale, la sidebar resta ferma.

Un breadcrumb testuale in testa all'area contenuto (`Nome corso / UDA 3 / Lezione 2`) rende sempre esplicito il livello corrente; click su un segmento del breadcrumb torna a quel livello, senza uscire dal workspace.

## 5. Navigazione mobile

Nessuna sidebar collassabile su mobile — sarebbe un compromesso di leggibilità su schermi stretti. Al suo posto, **navigazione progressiva a livelli**, un solo pannello a schermo:

```
Libreria corsi → Workspace (riepilogo + tabella UDA) → Lezioni dell'UDA → Lezione (schede)
```

Ogni livello ha un pulsante "← Indietro" coerente in testa al pannello, sempre nella stessa posizione, che risale di esattamente un livello (mai un "torna alla libreria" generico da un livello profondo — coerenza di aspettativa). Le schede Contenuto/Domande/Informazioni della lezione restano tab orizzontali anche su mobile (già un pattern leggero, non richiede drill-down ulteriore).

## 6. Anatomia card corso

Ogni card mostra **solo**:

- titolo del corso;
- anno scolastico (da `programmaMeta.annoScolastico`, già esistente — nessun nuovo campo);
- classe/i assegnate (da `classIds`/nomi classe già risolti lato client);
- numero UDA;
- lezioni svolte / totali (derivato da `LessonItem.completed`, già disponibile per programma);
- numero domande (derivato dal conteggio già presente in `questionIndex` per import, nessuna nuova lettura);
- barra di avanzamento discreta (percentuale lezioni svolte — un filo colorato sottile, non un widget invadente);
- menu contestuale `⋯` (rinomina, import ZIP, export ZIP, programma svolto, visibilità classi, elimina — le stesse azioni già presenti in `ProgramsView` oggi, spostate dal corpo espanso al menu della card).

Nessun'altra icona, badge o etichetta sulla card: la superficie resta scannerizzabile a colpo d'occhio anche con 15-20 corsi in libreria.

## 7. Anatomia workspace

**Intestazione corso** (sticky, sempre visibile): titolo, anno scolastico, classi assegnate, pulsante "← Torna alla libreria", azioni corso (le stesse del menu `⋯` della card, qui in toolbar perché il corso è l'elemento correntemente selezionato — vedi §9).

**Sidebar** (desktop, fissa a sinistra): esclusivamente struttura UDA → lezioni, un solo albero, riusato identico dalle tre schede. Ogni riga UDA è espandibile; ogni riga lezione mostra numero + titolo con tipografia uniforme (componente condiviso, §19) e l'indicatore di stato pool (§13). Nessuna fila di icone permanente sulle righe (§14) — solo il testo e l'indicatore pool.

**Area contenuto principale**: cambia in base alla selezione (§10-§12); la sidebar non si ridisegna mai in risposta al contenuto.

## 8. Comportamento per selezione

### 8.1 Nessuna selezione (corso appena aperto)

Riepilogo compatto del corso (le stesse metriche della card, qui più estese: data ultimo import, stato pool aggregato) + tabella UDA con metadata (descrizione breve, numero lezioni, lezioni svolte) e azioni contestuali per UDA (rinomina, elimina, riordina — dietro `⋯` salvo la modalità Organizza, §17).

### 8.2 Selezione UDA

Metadata UDA (descrizione, competenze, obiettivi — stesso form di editing già presente in `ProgramsView`) + tabella lezioni dell'UDA con: numero, titolo, stato "svolta" (checkbox, stesso comportamento di `setLessonCompleted` oggi), indicatore presenza/validità pool (§13).

### 8.3 Selezione lezione

Tre schede:

- **Contenuto** — consultazione/editor Markdown della lezione (stesso motore di `LessonsView` oggi: split front matter/corpo, editor con tab Editor/Anteprima, "Scarica PDF").
- **Domande** — Question Editor contestualizzato alla lezione selezionata (stesso motore di `DomandeView` oggi: crea/modifica/elimina pool e domande), senza dover riselezionare corso→UDA→lezione da un albero separato: il contesto è già quello della sidebar.
- **Informazioni** — front matter della lezione in sola lettura/modifica strutturata (titolo, sottotitolo, difficoltà, concetti chiave, obiettivi) — attualmente mescolato nel form "edit metadata" di `LessonsView`, qui isolato in una scheda dedicata per chiarezza.

## 9. Toolbar e azioni contestuali

Principio: **le azioni disponibili sono quelle dell'elemento attualmente selezionato**, mostrate nella toolbar in alto, non sparse in righe multiple. Se è selezionato un corso, la toolbar mostra le azioni corso; se è selezionata una lezione, le azioni lezione (elimina, duplica se prevista, ecc.). Le azioni rare (elimina, esporta, cambia visibilità) restano dietro il menu `⋯`, mai bottoni permanenti — coerente con "nessuna fila di icone sulle righe" (§14) e "azioni rare nel menu" (§16).

## 10. Modalità Organizza

Il riordino (UDA nel corso, lezioni nell'UDA) avviene **solo** dentro una modalità esplicita "Organizza", attivata da un pulsante dedicato nella toolbar del livello corrente. Dentro questa modalità:

- ogni riga riordinabile mostra frecce ↑/↓ canoniche (stesso pattern già usato da `reorderUda`/`reorderLesson` oggi) — **non** drag-and-drop, esplicitamente non necessario per liste di questa dimensione (tipicamente meno di 20 elementi per livello).
- Le altre azioni (rinomina, elimina, apri) sono disabilitate finché la modalità è attiva, per evitare stati misti.
- Un pulsante "Fine" esce dalla modalità e torna al comportamento normale della riga.

## 11. Integrazione Domande

La scheda "Domande" della lezione selezionata è il Question Editor esistente (`DomandeView`/`QuestionCard`/`QuestionEditorForm`), **contestualizzato**: riceve la lezione già selezionata dalla sidebar del workspace invece di dover navigare un proprio albero separato. Nessuna riscrittura della logica di editing pool (creazione, validazione YAML, editor domanda per domanda) — solo un cambio di come la lezione target viene scelta. Questo è l'obiettivo di DUX-03.

## 12. Integrazione Classi/Studenti

"Classi" cessa di essere una voce di primo livello e diventa un tab dentro "Studenti":

- tab **Studenti** — vista attuale invariata (ricerca, filtro stato, tabella con azioni riga, toggle globali portale/richieste/modalità verifica).
- tab **Classi** — tabella semplice: nome classe, contatore studenti assegnati (derivato lato client dai dati studenti già caricati, nessuna nuova lettura), azioni modifica/elimina sulla riga. Inserimento di una nuova classe **direttamente in una riga della tabella** (un piccolo form inline, non un widget/modal separato). Nessun campo descrizione (rimosso rispetto a `ClassesView` oggi — non usato in pratica, riduce rumore nella tabella).

## 13. Pool come proprietà della lezione

Il pool (domande) è concettualmente **parte della lezione**, non un'entità di navigazione separata. Il suo stato è sempre visibile accanto alla riga lezione ovunque compaia (sidebar workspace, tabella lezioni dell'UDA):

- **verde** — pool presente e valido;
- **grigio** — pool assente;
- **rosso** — pool presente ma non valido (errori di parsing/validazione).

L'indicatore non è **mai** affidato al solo colore: porta sempre anche un simbolo/etichetta testuale accessibile (es. `●`/`○`/`⚠` con `aria-label` esplicito, "Pool valido"/"Pool assente"/"Pool non valido" — già il pattern usato da `DomandeView` oggi, riportato inalterato).

## 14. Assenza di fila di icone permanente

Le righe (UDA, lezione, classe, studente) non portano mai una fila fissa di icone azione. L'unica eccezione visiva permanente per la riga lezione è l'indicatore di stato pool (§13), che è informazione di stato, non un'azione. Ogni azione compare o nella toolbar contestuale dell'elemento selezionato (§9) o nel menu `⋯` per le azioni rare (§16).

## 15. Componente riga lezione condiviso

Tutte le viste che elencano lezioni (sidebar workspace, tabella lezioni UDA, eventuale ricerca futura) usano lo stesso componente di riga: stessa tipografia, stesso ordine di elementi (numero, titolo, indicatore pool, stato svolta se applicabile), stesso comportamento hover/selezione. Elimina la divergenza attuale in cui `LessonsView` e `DomandeView` disegnano la riga lezione in due modi leggermente diversi.

## 16. Restauro Template

`TemplateKitView` resta una voce autonoma (non assorbita da Didattica, perché non riguarda un corso specifico) ma viene ripulita nella forma:

- **Kit completo** — il download ZIP aggregato, in evidenza come azione primaria.
- **Template singoli** — lista dei file scaricabili singolarmente, secondaria.
- **Guida compatta** — istruzioni minime "come usare questi template con uno strumento AI o manualmente", sostituendo eventuale testo diffuso attuale.
- **Struttura ZIP di esempio** — un albero di cartelle/file di esempio mostrato staticamente (testo preformattato), per chiarire cosa un import ZIP si aspetta senza dover aprire un file reale.

Nessuna nuova funzionalità (nessun editor template, nessuna generazione assistita) — solo chiarezza visiva su ciò che già esiste.

## 17. Visual direction

- Eliminare il motivo diagonale a gradiente dell'header `TeacherShell` attuale.
- Base scura sobria (riuso dei token `--color-surface`/`--color-surface-subtle`/`--color-surface-raised` già definiti in `index.css`, nessuna nuova palette).
- Glow radiali molto leggeri (intensità ridotta rispetto al glow arancione attuale nell'header), usati con parsimonia come accento, mai come motivo dominante.
- Pannelli leggibili: contrasto testo/sfondo verificato (stesso standard AA già richiesto per RE/QE), bordi sottili invece di ombre pesanti.
- Logo sempre ad alto contrasto, indipendentemente dal glow di sfondo sottostante.
- Nessuna decorazione aggressiva: niente pattern ripetuti, niente animazioni decorative, niente gradient multipli sovrapposti.

Il prototipo statico (`documentazione/prototipi/didattica-workspace.html`) è la sede in cui questa direzione viene giudicata concretamente dal docente, non questo documento.

## 18. Accessibilità

- Contrasto testo/sfondo AA su tutte le superfici (libreria, workspace, tabelle).
- Ogni indicatore di stato (pool, avanzamento, badge classe) ha un equivalente testuale/`aria-label`, mai solo colore (§13).
- Focus visibile su ogni elemento interattivo (card, riga, pulsante, tab) — riuso dello stile focus già presente nel design system attuale.
- Breadcrumb e pulsanti "Indietro" sono elementi `<button>`/`<a>` veri, navigabili da tastiera.
- Le schede Contenuto/Domande/Informazioni sono un tablist ARIA standard (`role="tablist"`/`role="tab"`/`role="tabpanel"`), non semplici `<div>` cliccabili.
- Nessuna informazione trasmessa esclusivamente tramite animazione o hover-only.

## 19. Sicurezza

Didattica non introduce alcuna nuova superficie di autorizzazione: riusa gli stessi service e le stesse Security Rules già in vigore per RE (`programs`/UDA/lezioni) e QE (`questionIndex`/pool), invariate.

- Didattica esiste **solo** dentro `TeacherShell`. Nessun componente Didattica (libreria, workspace, editor pool contestualizzato) è mai importato da `StudentShell`.
- Lo studente continua a leggere esclusivamente le proiezioni sanificate `publicLessons` — Didattica non tocca né duplica questa proiezione, non aggiunge nuovi campi letti dallo studente.
- `lessons`, `questionIndex`, i pool, le soluzioni e ogni operazione di repository restano owner-only, come oggi — nessuna Security Rule viene resa più permissiva per abilitare Didattica.
- La Modalità verifica (M3F-07) continua a bloccare le lezioni lato studente esattamente come oggi — Didattica è un refactor esclusivamente lato docente e non interagisce con `examMode`.
- Nessuna azione Didattica (creazione, modifica, riordino, eliminazione) è raggiungibile da uno studente, né via UI (mai montata in `StudentShell`) né via API diretta (Security Rules invariate, owner-only).
- Conseguenza diretta: **nessuna PR di implementazione DUX richiede modifiche a `firestore.rules`/`storage.rules`** salvo scoperta di un gap dimostrato — in tal caso va trattato come le eccezioni già documentate nei fix post-review di M4 (fix minimo, documentato, testato con Emulator).

## 20. Budget di letture/scritture

Vincoli invarianti per ogni fase di implementazione DUX (DUX-01 in avanti):

- **Nessuna query per card corso**: la libreria carica l'elenco programmi con le stesse letture già fatte oggi da `ProgramsView` (una lista programmi + import attivo per import), non una query aggiuntiva per corso.
- **Nessun listener nuovo** (`onSnapshot`): tutte le letture restano `getDoc`/`getDocs` one-shot, come l'intero codice teacher-side attuale.
- **Nessun polling**.
- **Nessun documento di statistiche persistito**: UDA totali, lezioni svolte/totali, numero domande sono **derivati** dai dati già caricati (stessa fonte di `listUdas`/`listLessons`/`questionIndex` per import), mai scritti in un nuovo documento Firestore "riepilogo corso".
- **Filtri anno scolastico/classe/ricerca lato client**: nessuna nuova query per filtro — la libreria carica l'elenco completo dei programmi del docente (già una lettura owner-only limitata, non paginata oggi) e filtra in memoria.
- **Dettaglio UDA/lezioni caricato preferibilmente all'apertura del corso** (non nella libreria): la libreria mostra solo i conteggi aggregati già disponibili da `ProgramItem`/`ImportDoc`/`questionIndex` count; l'albero UDA→lezioni completo si carica quando il docente apre il workspace di un corso specifico, non per tutti i corsi in libreria.
- **Nessuna Cloud Function** aggiunta o modificata.
- **Nessuna nuova dipendenza UI**: solo React + CSS Modules già presenti, nessuna libreria di componenti, nessun framework di stato aggiuntivo, nessuna libreria drag-and-drop (§10 esclude drag-and-drop esplicitamente).

## 21. Strategia di migrazione

Migrazione incrementale, mai un "big bang":

1. **DUX-00** (questo documento + prototipo) — nessun codice applicativo toccato. Corsi/Lezioni/Domande restano tre voci di nav invariate e pienamente funzionanti.
2. **DUX-01** introduce la voce `Didattica` e la libreria corsi come **nuova** vista, dietro la nav esistente — Corsi/Lezioni/Domande restano ancora presenti e invariate in parallelo (nessuna rimozione), così il docente può confrontare senza rischio di regressione.
3. **DUX-02** introduce il workspace corso (sidebar + selezione UDA/lezione + scheda Contenuto), riusando `lessonsService`/`udaService` esistenti. A questo punto `LessonsView` diventa ridondante ma non viene ancora rimossa.
4. **DUX-03** integra la scheda Domande (Question Editor contestualizzato), riusando `questionsService`/`poolService` esistenti. `DomandeView` diventa ridondante ma non viene ancora rimossa.
5. **DUX-04** completa la navigazione mobile a livelli e la modalità Organizza; a questo punto Didattica copre il 100% delle funzionalità di Corsi+Lezioni+Domande. Solo qui, con evidenza DoD verificata, le tre voci di nav legacy vengono rimosse dalla `TeacherShell` in un'unica PR dedicata e reversibile (revert singolo se necessario).
6. **DUX-05** assorbe Classi in Studenti (tab), ripulisce Template, applica il visual polish finale (§17) al resto della shell.
7. **Gate GDUX** verifica l'insieme: nessuna funzionalità persa rispetto allo stato pre-DUX, nessuna regressione di sicurezza/costo, checklist manuale DEV completa.

Nessun modulo esistente (Corsi/Lezioni/Domande/Classi) viene dichiarato "rimosso" prima che il pacchetto DUX corrispondente sia effettivamente implementato, testato e verificato — fino ad allora restano la fonte di verità funzionante.

## 22. Acceptance criteria

**DUX-00 (questo pacchetto):**

- `documentazione/didattica-ux-roadmap.md` esiste e copre tutte le sezioni richieste.
- `documentazione/prototipi/didattica-workspace.html` si apre in un browser senza rete, senza dipendenze CDN, senza dati reali, e mostra tutte le schermate elencate in §23 del prototipo (vedi file).
- Nessun file sotto `apps/web/src/` è stato modificato.
- `documentazione/INDEX.md`, `documentazione/piano-implementazione.md`, `README.md` riflettono lo stato "DUX-00 approvato, non implementato" senza dichiarare Corsi/Lezioni/Domande deprecate.

**Gate GDUX (a fine roadmap, non in questa PR):**

- Ogni funzionalità oggi coperta da Corsi/Lezioni/Domande/Classi è raggiungibile da Didattica+Studenti.
- Nessuna nuova Security Rule più permissiva rispetto alla baseline pre-DUX.
- Nessun nuovo documento Firestore di tipo "statistiche/riepilogo" introdotto.
- Nessuna regressione nei test automatici esistenti su RE/QE/M3-full/M4.
- Checklist manuale DEV eseguita su desktop e mobile (drill-down, modalità Organizza, indicatori pool, tab Classi/Studenti).
- `TeacherShell` non espone più le voci di nav legacy Corsi/Lezioni/Domande/Classi (assorbite).

## 23. Roadmap

| ID | Outcome e scope | Dipende da | Evidenza DoD |
|---|---|---|---|
| DUX-00 | Specifica UX completa (questo documento) e prototipo statico standalone. Nessun codice applicativo toccato. | — | Documento e prototipo revisionabili dal docente; nessuna modifica sotto `apps/web/src/`. |
| DUX-01 | Libreria corsi: nuova voce `Didattica`, landing a card, toolbar filtri (anno/classe/ricerca), "Nuovo corso"/"Importa ZIP". Corsi/Lezioni/Domande restano invariate in parallelo. | DUX-00 | Card mostra le sole metriche di §6; filtri client-side, nessuna nuova query; nessuna Rule modificata. |
| DUX-02 | Workspace corso: intestazione, sidebar UDA/lezioni condivisa, selezione corso/UDA con tabelle, scheda Contenuto lezione. | DUX-01 | Sidebar unica riusata da tutte le selezioni; caricamento UDA/lezioni all'apertura del corso, non in libreria. |
| DUX-03 | Scheda Domande contestualizzata (Question Editor integrato nel workspace) e scheda Informazioni lezione. | DUX-02 | Editing pool identico a `DomandeView` oggi, stesso contesto lezione della sidebar, nessuna duplicazione di logica di validazione pool. |
| DUX-04 | Navigazione mobile a livelli, pulsante Indietro coerente, modalità Organizza (frecce su/giù), rimozione delle voci di nav legacy Corsi/Lezioni/Domande. | DUX-03 | Parità funzionale verificata; PR di rimozione separata e reversibile. |
| DUX-05 | Classi assorbita in Studenti (tab), restauro Template (§16), visual polish finale (§17) sul resto della shell. | DUX-04 | Tab Classi con contatore derivato client-side; Template ripulito; nessun motivo diagonale residuo. |
| Gate GDUX | Verifica finale end-to-end di tutta la roadmap Didattica. | DUX-01…05 | Checklist manuale DEV + evidenze automatiche, vedi §22. |

---

*Documento companion: [prototipi/didattica-workspace.html](prototipi/didattica-workspace.html) — prototipo statico standalone per la revisione visiva del docente. Non collegato a nessun service reale, dati interamente inventati.*
