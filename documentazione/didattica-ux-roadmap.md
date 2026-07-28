# Didattica — Roadmap UX (DUX)

**Versione:** 1.1
**Stato:** DUX-00→DUX-10A implementati; viste legacy rimosse, Classi assorbita in Studenti, Verifiche uniformata, polish responsive ed editing metadata corso applicati. **Gate GDUX superato (PASS)** — vedi [`evidenze/gdux-checklist-finale.md`](evidenze/gdux-checklist-finale.md).
**Dipendenze:** nessuna dipendenza tecnica da M4 (M4-03/M4-04 continuano in parallelo); riusa esclusivamente backend/service/dati già esistenti di RE (Repository Editor) e QE (Question Editor).

---

## 1. Problema di partenza (prima di DUX)

Prima dell'implementazione DUX, il docente lavorava su tre sezioni separate del `TeacherShell` che erano tre viste diverse sullo **stesso corso**:

- **Corsi** (`ProgramsView`) — creazione/import ZIP/export/visibilità classi/programma svolto, con un albero corso→UDA→lezione minimale solo per completamento/metadata UDA.
- **Lezioni** (`LessonsView`) — stesso albero corso→UDA→lezione, riproposto da zero, per leggere/modificare contenuto Markdown e front matter della lezione.
- **Domande** (`DomandeView`) — di nuovo lo stesso albero corso→UDA→lezione, riproposto una terza volta, per editare il pool di domande della lezione.

Conseguenze concrete rilevate nel codice di partenza:

- Lo stesso albero di navigazione (programma → UDA → lezione) è implementato e mantenuto **tre volte**, con tre stati di espansione (`expandedCourses`/`expandedUdas`) indipendenti — aprire una lezione in "Lezioni" non lascia alcuna traccia se il docente passa a "Domande" per la stessa lezione.
- Non esiste un concetto di "sto lavorando su questo corso": il docente deve ricostruire il contesto (quale UDA, quale lezione) da capo a ogni cambio di tab.
- La sezione "Classi" è una voce di primo livello del tutto scollegata da "Studenti", pur essendo dati strettamente correlati (assegnazione classe↔studente).
- Il corpo della shell è visivamente piatto e tecnico: l'identità dell'header dell'app (pannello chiaro, logo-scritta, bordo bicolore) è valida e va conservata, ma il fondo scuro sotto di esso non comunica ancora la cura "Markdown-first, professionale" voluta dal brief, e la navigazione a tab non trasmette la gerarchia delle sezioni.
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
├── Verifiche            (invariata nel concetto/comportamento; solo restyling
│                          visivo di coerenza con Studenti/Classi in DUX-05 —
│                          tabella con riga di creazione inline, dettaglio
│                          sotto la tabella al click, stesso linguaggio visivo)
├── Studenti              ← assorbe Classi come tab
│    ├── tab Studenti
│    └── tab Classi
└── Template              (voce autonoma temporanea, ripulita in DUX-05)
```

Corsi/Lezioni/Domande **non spariscono immediatamente**: la migrazione (§16) è a fasi, e ogni fase è un pacchetto DUX-0x separato, dietro le stesse guardie architetturali già in vigore per RE/QE (nessuna nuova Cloud Function, nessuna Security Rule più permissiva, dati letti dagli stessi service `programsService`/`lessonsService`/`questionsService`/`udaService`).

## 4. Navigazione desktop

Tre livelli di profondità, mai di più:

1. **Libreria** (`Didattica` cliccata dalla nav) — griglia di card corso.
2. **Workspace corso** (click su una card) — intestazione corso + sidebar (UDA/lezioni) + area contenuto principale. Su desktop la sidebar condivisa può essere collassata per ampliare il contenuto; su mobile è sostituita dalla navigazione a livelli definita in DUX-04C.
3. **Dettaglio** all'interno del workspace: selezione UDA (tabella lezioni) o selezione lezione (schede Contenuto/Domande/Informazioni). Questo terzo livello vive nell'area contenuto principale, la sidebar resta ferma.

Un breadcrumb testuale in testa all'area contenuto (`Nome corso / UDA 3 / Lezione 2`) rende sempre esplicito il livello corrente; click su un segmento del breadcrumb torna a quel livello, senza uscire dal workspace.

## 5. Navigazione mobile

Nessuna sidebar collassabile su mobile — sarebbe un compromesso di leggibilità su schermi stretti. Al suo posto, **navigazione progressiva a livelli**, un solo pannello a schermo:

```
Libreria corsi → Workspace (riepilogo + tabella UDA) → Lezioni dell'UDA → Lezione (schede)
```

Ogni livello ha un pulsante "← Indietro" coerente in testa al pannello, sempre nella stessa posizione, che risale di esattamente un livello (mai un "torna alla libreria" generico da un livello profondo — coerenza di aspettativa). Le schede Contenuto/Domande/Informazioni della lezione restano tab orizzontali anche su mobile (già un pattern leggero, non richiede drill-down ulteriore).

**Filtri libreria su mobile (fix review)**: la toolbar filtri si dispone su tre righe — riga 1: anno scolastico e classe, due colonne identiche; riga 2: ricerca a piena larghezza; riga 3: "Importa ZIP" e "Nuovo corso", due bottoni identici per larghezza e altezza. Sotto i ~360px anno e classe passano a una colonna singola. Nessun overflow orizzontale in nessun caso; lo stato vuoto (§6/§21) resta correttamente allineato sotto la griglia dei filtri.

## 6. Anatomia card corso

Ogni card mostra **solo**:

- titolo del corso;
- anno scolastico (da `programmaMeta.annoScolastico`, già esistente — nessun nuovo campo);
- classe/i assegnate (da `classIds`/nomi classe già risolti lato client);
- numero UDA;
- lezioni svolte / totali (derivato da `LessonItem.completed`, già disponibile per programma);
- numero domande (derivato dal conteggio già presente in `questionIndex` per import, nessuna nuova lettura);
- barra di avanzamento discreta (percentuale lezioni svolte — un filo colorato sottile, non un widget invadente);
- menu contestuale `⋯` (rinomina, import ZIP, export ZIP, programma svolto, visibilità classi, elimina — le stesse azioni della precedente `ProgramsView`, spostate dal corpo espanso al menu della card).

Nessun'altra icona, badge o etichetta sulla card: la superficie resta scannerizzabile a colpo d'occhio anche con 15-20 corsi in libreria.

## 7. Anatomia workspace

**Intestazione corso** (sticky, sempre visibile): titolo, anno scolastico, classi assegnate, pulsante "← Torna alla libreria", azioni corso (le stesse del menu `⋯` della card, qui in toolbar perché il corso è l'elemento correntemente selezionato — vedi §9).

**Sidebar** (desktop, fissa a sinistra): esclusivamente struttura UDA → lezioni, un solo albero, riusato identico dalle tre schede. Ogni riga UDA è espandibile; ogni riga lezione mostra numero + titolo con tipografia uniforme (componente condiviso, §19) e l'indicatore di stato pool (§13). Nessuna fila di icone permanente sulle righe (§14) — solo il testo e l'indicatore pool.

**Area contenuto principale**: cambia in base alla selezione (§10-§12); la sidebar non si ridisegna mai in risposta al contenuto.

## 8. Comportamento per selezione

### 8.1 Nessuna selezione (corso appena aperto)

Riepilogo compatto del corso (le stesse metriche della card, qui più estese: data ultimo import, stato pool aggregato) + tabella UDA con metadata (descrizione breve, numero lezioni, lezioni svolte) e azioni contestuali per UDA (rinomina, elimina, riordina — dietro `⋯` salvo la modalità Organizza, §17).

### 8.2 Selezione UDA

Metadata UDA (descrizione, competenze, obiettivi — form derivato dalla precedente `ProgramsView`) + tabella lezioni dell'UDA con: numero, titolo, stato "svolta" (checkbox, comportamento di `setLessonCompleted`), indicatore presenza/validità pool (§13).

### 8.3 Selezione lezione

Tre schede:

- **Contenuto** — consultazione/editor Markdown della lezione (motore derivato dalla precedente `LessonsView`: split front matter/corpo, editor con tab Editor/Anteprima). Il comando PDF della singola lezione è temporaneamente nascosto da PRE-AIGEN-01 in attesa di riprogettazione grafica.
- **Domande** — Question Editor contestualizzato alla lezione selezionata (motore estratto dalla precedente `DomandeView`: crea/modifica/elimina pool e domande), senza dover riselezionare corso→UDA→lezione da un albero separato: il contesto è già quello del workspace.
- **Informazioni** — front matter della lezione in sola lettura/modifica strutturata (titolo, sottotitolo, difficoltà, concetti chiave, obiettivi), isolato in una scheda dedicata per chiarezza.

## 9. Toolbar e azioni contestuali

Principio: **le azioni disponibili sono quelle dell'elemento attualmente selezionato**, mostrate nella toolbar in alto, non sparse in righe multiple. Se è selezionato un corso, la toolbar mostra le azioni corso; se è selezionata una lezione, le azioni lezione (elimina, duplica se prevista, ecc.). Le azioni rare (elimina, esporta, cambia visibilità) restano dietro il menu `⋯`, mai bottoni permanenti — coerente con "nessuna fila di icone sulle righe" (§14) e "azioni rare nel menu" (§16).

## 10. Modalità Organizza

Il riordino (UDA nel corso, lezioni nell'UDA) avviene **solo** dentro una modalità esplicita "Organizza", attivata da un pulsante dedicato nella toolbar del livello corrente. Dentro questa modalità:

- ogni riga riordinabile mostra frecce ↑/↓ canoniche (stesso pattern già usato da `reorderUda`/`reorderLesson` oggi) — **non** drag-and-drop, esplicitamente non necessario per liste di questa dimensione (tipicamente meno di 20 elementi per livello).
- Le altre azioni (rinomina, elimina, apri) sono disabilitate finché la modalità è attiva, per evitare stati misti.
- Un pulsante "Fine" esce dalla modalità e torna al comportamento normale della riga.

## 11. Integrazione Domande

La scheda "Domande" della lezione selezionata usa `QuestionPoolEditor`, estratto dalla precedente `DomandeView` e **contestualizzato**: riceve la lezione già selezionata dal workspace invece di dover navigare un proprio albero separato. Nessuna riscrittura della logica di editing pool (creazione, validazione YAML, editor domanda per domanda) — solo un cambio di come la lezione target viene scelta. Questo è l'obiettivo di DUX-03.

## 12. Integrazione Classi/Studenti

"Classi" cessa di essere una voce di primo livello e diventa un tab dentro "Studenti":

- tab **Studenti** — vista attuale invariata (ricerca, filtro stato, tabella con azioni riga, toggle globali portale/richieste/modalità verifica).
- tab **Classi** — tabella semplice: nome classe, contatore studenti assegnati (derivato lato client dai dati studenti già caricati, nessuna nuova lettura), azioni modifica/elimina sulla riga. Inserimento di una nuova classe **direttamente in una riga della tabella** (un piccolo form inline, non un widget/modal separato), con la **stessa griglia/colonne, padding, bordi e altezza** delle righe esistenti — l'input nome vive nella colonna "Classe", la colonna "Studenti" mostra `—` (non ancora nota), il pulsante di conferma è centrato nella colonna Azioni (le righe esistenti invece allineano a destra la coppia Modifica/Elimina, coerente con l'avere un'unica azione da centrare qui). Nessun campo descrizione (rimosso rispetto a `ClassesView` oggi — non usato in pratica, riduce rumore nella tabella).

**Verifiche — restyling di coerenza (fix review, DUX-05)**: la sezione resta concettualmente identica a oggi (nessuna nuova logica applicativa, nessun cambio del modello dati) ma adotta lo stesso linguaggio visivo di Studenti/Classi: tabella con colonne Titolo/Corso/Classe/Stato/Domande/Azioni, prima riga della tabella dedicata alla creazione inline (titolo, corso, classe opzionale, stato "Nuova", pulsante "Crea verifica" — stesso pattern della riga di inserimento Classi), righe successive per le verifiche esistenti. Il click su una verifica apre il dettaglio/configurazione **sotto la tabella**, non in una vista separata; il picker domande nel dettaglio è rappresentativo del solo layout, non introduce editing reale. Su mobile la riga di creazione diventa una sezione impilata compatta, visivamente collegata alla lista sottostante — mai una card enorme e separata.

**Feedback "Salva bozza" persistente (fix review, DUX-05)**: lo stato del salvataggio (modifiche non salvate / salvataggio in corso / salvato / errore) è sempre visibile accanto al pulsante di salvataggio, **mai un solo toast destinato a sparire**. In dettaglio: `● Modifiche non salvate` quando c'è una modifica non ancora persistita; il pulsante mostra `Salvataggio…` disabilitato durante l'operazione; al successo `✓ Bozza salvata alle HH:mm`, con il timestamp che resta visibile finché non arriva una nuova modifica o un nuovo salvataggio (un breve richiamo visivo temporaneo è accettabile, ma non sostituisce lo stato persistente); in caso di errore un messaggio non auto-dismiss con possibilità di riprovare.

## 13. Pool come proprietà della lezione

Il pool (domande) è concettualmente **parte della lezione**, non un'entità di navigazione separata. Il suo stato è sempre visibile accanto alla riga lezione ovunque compaia (sidebar workspace, tabella lezioni dell'UDA):

- **verde** — pool presente e valido;
- **grigio** — pool assente;
- **rosso** — pool presente ma non valido (errori di parsing/validazione).

L'indicatore non è **mai** affidato al solo colore: porta sempre anche un simbolo/etichetta testuale accessibile (es. `●`/`○`/`⚠` con `aria-label` esplicito, "Pool valido"/"Pool assente"/"Pool non valido" — pattern ereditato dalla precedente `DomandeView`).

## 14. Assenza di fila di icone permanente

Le righe (UDA, lezione, classe, studente) non portano mai una fila fissa di icone azione. L'unica eccezione visiva permanente per la riga lezione è l'indicatore di stato pool (§13), che è informazione di stato, non un'azione. Ogni azione compare o nella toolbar contestuale dell'elemento selezionato (§9) o nel menu `⋯` per le azioni rare (§16).

## 15. Componente riga lezione condiviso

Tutte le viste che elencano lezioni (sidebar workspace, tabella lezioni UDA, eventuale ricerca futura) mantengono la stessa tipografia e lo stesso ordine di elementi (numero, titolo, indicatore pool, stato svolta se applicabile). Questo elimina la divergenza che esisteva tra le precedenti `LessonsView` e `DomandeView`.

## 16. Restauro Template

`TemplateKitView` resta una voce autonoma (non assorbita da Didattica, perché non riguarda un corso specifico) ma viene ripulita nella forma:

- **Kit completo** — il download ZIP aggregato, in evidenza come azione primaria.
- **Template singoli** — griglia a piena larghezza: 4 colonne identiche su desktop, 2×2 su tablet, 1 colonna su mobile (colonne esplicite, mai auto-fill, così l'ultima riga non si accorcia né si sposta a sinistra); card della stessa altezza; download come bottone icon-only (icona vettoriale inline, mai emoji/caratteri dipendenti dal font) con `aria-label` specifica per template (es. "Scarica template programma") e tooltip.
- **Guida compatta** — istruzioni minime "come usare questi template con uno strumento AI o manualmente", sostituendo eventuale testo diffuso attuale.
- **Struttura ZIP di esempio** — un albero di cartelle/file di esempio mostrato staticamente (testo preformattato), per chiarire cosa un import ZIP si aspetta senza dover aprire un file reale.

Nessuna nuova funzionalità (nessun editor template, nessuna generazione assistita) — solo chiarezza visiva su ciò che già esiste.

## 17. Visual direction

- **Header unico su una riga**: `[Logo-scritta] [Didattica][Verifiche][Studenti][Template] … [Account]`, mai due barre di navigazione separate. Conserva **l'identità visiva dell'header reale** (`TeacherShell`): pannello chiaro con gradiente blu→violetto e glow arancio in alto a destra, bordo bicolore blu→arancio in fondo, logo-scritta completo (immagine con wordmark incluso — non la sola icona) e avatar account a destra. La novità DUX è solo la navigazione: veri **pulsanti** con iconcina coerente già in uso nell'app (Didattica 📚, Verifiche 📝, Studenti 🎓, Template 📄) + testo — pill leggibili sul pannello chiaro, **non** tab con solo bordo inferiore — con stato attivo pieno (`aria-current="page"`, blu profondo con testo bianco in AA) e focus da tastiera visibile. **Su mobile** i quattro pulsanti non stanno accanto a logo+account senza scroll orizzontale, quindi la fila viene sostituita da un **selettore di sezione**: un unico pulsante che mostra la sezione corrente (icona + nome) e apre un menu a tendina con tutte le sezioni (voce attiva evidenziata). Così la sezione corrente resta sempre visibile, il logo non viene mai nascosto e non serve alcuno scroll. Nessuna seconda barra: è lo stesso header, con la nav che cambia forma sotto una certa larghezza.
- **Body "aurora sobria"**: il corpo della pagina (sotto l'header) usa una base navy scura leggermente più viva (riuso dei token `--color-surface`/`--color-surface-subtle`/`--color-surface-raised`, nessuna nuova palette) con quattro glow radiali tenui ma percepibili — blu/ciano in alto a sinistra, viola-blu ampio al centro, arancio/corallo in alto a destra, blu in basso a destra — che danno carattere agli spazi vuoti, mai un motivo dominante, geometrico o animato; i pannelli restano opachi e non ne sono mai attraversati. (L'"aurora" riguarda il fondo del corpo, non l'header, che mantiene il pannello chiaro dell'app.)
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
- **Nessun controllo interattivo annidato in un altro** (es. un bottone dentro un elemento con `role="button"`, o un bottone dentro un altro bottone): card corso, righe UDA/lezione e voci di drill-down mobile sono sempre `<button>` reali, con eventuali azioni secondarie (menu `⋯`, frecce di riordino) rese come controlli fratelli separati, mai innestati — verificato nel prototipo DUX-00 (§ fix review) e vincolante per l'implementazione reale.

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

- **Nessuna query per card corso**: la libreria conserva il budget di letture della precedente `ProgramsView` (una lista programmi + import attivo per import), senza introdurre una query aggiuntiva per corso.
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
6. **DUX-05A** assorbe Classi in Studenti (tab) e rimuove la voce di navigazione autonoma.
7. **DUX-05B** applica il restyling di coerenza a Verifiche e il feedback persistente di salvataggio bozza.
8. **DUX-05C** ripulisce Template e applica header/aurora finali (§17) al resto della shell.
9. **Gate GDUX** verifica l'insieme: nessuna funzionalità persa rispetto allo stato pre-DUX, nessuna regressione di sicurezza/costo, checklist manuale DEV completa.

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
- **Coerenza desktop/mobile**: passando dal simulatore/breakpoint desktop a quello mobile (e viceversa) con una selezione attiva (corso/UDA/lezione), il livello di navigazione mostrato è sempre sincronizzato con la selezione corrente — mai un livello residuo di una sessione precedente. Il breadcrumb desktop non è mai mostrato lato mobile (la navigazione a livelli con pulsante Indietro lo sostituisce integralmente).
- **Controlli navigabili semanticamente**: ogni elemento cliccabile che rappresenta una selezione (card corso, riga UDA, riga lezione, voce di drill-down mobile) è un vero elemento interattivo nativo (`<button>` o `<a>`), mai un contenitore generico con solo un gestore di click — raggiungibile e attivabile da tastiera, con focus visibile, senza controlli interattivi annidati l'uno nell'altro.
- `TeacherShell` non espone più le voci di nav legacy Corsi/Lezioni/Domande/Classi (assorbite).

## 23. Roadmap

| ID | Outcome e scope | Dipende da | Evidenza DoD |
|---|---|---|---|
| DUX-00 | Specifica UX completa (questo documento) e prototipo statico standalone. Nessun codice applicativo toccato. | — | Documento e prototipo revisionabili dal docente; nessuna modifica sotto `apps/web/src/`. |
| DUX-01 ✅ | Libreria corsi: nuova voce `Didattica`, landing a card, toolbar filtri (anno/classe/ricerca), "Nuovo corso"/"Importa ZIP". Corsi/Lezioni/Domande restano invariate in parallelo. **Implementato** (`DidatticaView` + servizio `courseLibrary`). | DUX-00 | Card mostra le sole metriche di §6; filtri client-side, nessuna nuova query oltre a quelle già spese da Corsi; nessuna Rule modificata. |
| DUX-02 ✅ | Workspace corso: intestazione, sidebar UDA/lezioni condivisa, selezione corso/UDA con tabelle, scheda Contenuto lezione. **Implementato** (`CourseWorkspace`, secondo livello dentro `DidatticaView`; bridge `initialExpandedProgramId` rimosso). | DUX-01 | Sidebar unica riusata da tutte le selezioni; UDA/lezioni caricate una sola volta all'apertura (2 read), Markdown on-demand alla selezione lezione; nessuna lettura pool. |
| DUX-03 ✅ | Scheda Domande contestualizzata (Question Editor integrato nel workspace) e scheda Informazioni lezione. **Implementato**: schede Contenuto/Domande/Informazioni, `QuestionPoolEditor` inizialmente condiviso con la vista legacy e poi conservato come editor unico dalla rimozione DUX-04D. | DUX-02 | Editing pool preservato nello stesso componente estratto, stesso contesto lezione del workspace, nessuna duplicazione di logica di validazione pool; pool letto solo all'apertura di Domande, una volta per lezione. |
| DUX-04A ✅ | Parità operativa **azioni Corso e UDA** nel workspace: toolbar contestuale + menu `⋯`; azioni corso (modifica titolo, importa/esporta ZIP, programma svolto MD/PDF, classi, informazioni, eliminazione con guard verifiche) e azioni UDA (metadata, nuova UDA, eliminazione con guard verifiche). Legacy Corsi/Lezioni/Domande ancora presenti. **Implementato** (`CourseWorkspace` + dialog condivisi `workspaceDialogs`). | DUX-03 | Riuso esclusivo dei service Repository Editor/programs; aggiornamento locale card/tree; nessuna Rule/documento/indice nuovo; parità **non** ancora completa (manca DUX-04B/C/D). |
| DUX-04B ✅ | Editing completo **lezione** nel workspace: toolbar lezione (modifica contenuto/informazioni, segna svolta, `⋯` elimina), editor contenuto Markdown con anteprima, form metadata lezione, creazione ed eliminazione lezione (con guard verifiche). **Implementato** (`CourseWorkspace` + editor condivisi `lessonEditors` + `NewLessonDialog`). Il PDF della singola lezione, originariamente presente, è nascosto da PRE-AIGEN-01 in attesa di riprogettazione. | DUX-04A | Riuso esclusivo dei service Repository Editor (`createLesson`/`updateLessonMarkdownBody`/`updateLessonMetadata`/`deleteLesson`) + `setLessonCompleted`; dirty-guard unificato (pool + contenuto + metadata); aggiornamento locale albero/card; nessuna nuova Rule. Parità **non** ancora completa (manca 04C/D). |
| DUX-04C ✅ | Navigazione mobile a livelli (drill-down: libreria→corso→UDA→lezione, un livello per volta, sidebar desktop assente su mobile, Indietro risale di un livello), modalità **Organizza** (riordino UDA a livello corso e lezioni a livello UDA con frecce su/giù). **Implementato** (`CourseWorkspace`: hook `useIsMobile`, `ReorderControls`, `reorderUda`/`reorderLesson`). | DUX-04B | Stessa `selection` come fonte di verità desktop/mobile; riordino via i service esistenti, order aggiornati solo dopo successo, nessuna rilettura; nessun drag-and-drop; nessun bottone annidato; nessuna nuova Rule. Parità **non** ancora completa (manca il Gate 04D). |
| DUX-04D ✅ | **Gate di parità** end-to-end (matrice `documentazione/evidenze/dux-04d-matrice-parita.md`, verdetto PASS) e **rimozione** delle voci di nav legacy Corsi/Lezioni/Domande + relativi componenti (`ProgramsView`/`LessonsView`/`DomandeView`/`ImportZipModal`). Backfill `publicLessons` spostato in Didattica (avviso di manutenzione). **Implementato.** | DUX-04C | Parità coperta o ritirata con motivazione per ogni controllo; componenti condivisi conservati (`QuestionPoolEditor`, `lessonEditors`, `workspaceDialogs`, `MarkdownRenderer`); nessuna nuova Rule; nav docente = Didattica/Verifiche/Classi/Studenti/Template. |
| DUX-05A ✅ | Classi assorbita in Studenti con tab accessibili, inserimento inline e contatore studenti derivato client-side; rimossa la voce autonoma Classi e la relativa vista legacy. **Implementato.** | DUX-04D | Nessuna nuova lettura: classi e studenti sono caricati una volta da `StudentsView`; contatori calcolati in memoria; CRUD esistente preservato; nav docente = Didattica/Verifiche/Studenti/Template. |
| DUX-05B ✅ | Restyling di coerenza di Verifiche: tabella + creazione inline + feedback persistente "Salva bozza". **Implementato.** | DUX-05A | Concetto e service invariati; feedback dirty/saving/saved/error persistente vicino alle azioni; nessuna modifica a Rules/schema. |
| DUX-05C ✅ | Restauro Template (griglia 4/2/1), header unico definitivo e "aurora sobria" sul corpo della shell (§17). **Implementato.** | DUX-05B | Template ripulito; header a riga singola con selettore mobile; SVG locali; fondo statico senza pattern, nuove letture o dipendenze. |
| DUX-06A ✅ | Hardening funzionale del workspace Didattica dopo lo smoke DEV: menu contestuali non ritagliati, chiusura click-esterno/Escape, recupero del draft Informazioni tra schede, sidebar gerarchica con icone e indicatori distinti per lezione svolta e stato pool, controlli icona uniformati. **Implementato.** | DUX-05C | Nessuna nuova funzione, lettura, scrittura, Rule o dipendenza; pool valido/assente/non valido ha indicatore testuale oltre al colore; draft non perso tra schede. |
| DUX-06B ✅ | Polish della libreria e del workspace Didattica: toolbar filtri su superficie coerente, ricerca moderna, card interamente apribile con titolo su due righe, padding delle righe e rimozione dei titoletti contestuali ridondanti. **Implementato.** | DUX-06A | Solo UX/UI, nessuna modifica ai contratti repository, alle letture o alle scritture. |
| DUX-06C ✅ | Coerenza Studenti/Classi e Verifiche: controlli globali separati dal pannello dati con tab interno, inserimento classe stabile, tabella verifiche compatta su desktop e dettaglio a livello dedicato. **Implementato.** | DUX-06B | Nessuna nuova lettura o modifica a Rules/schema; lista e dettaglio verifica non si accumulano verticalmente. |
| DUX-07A ✅ | Rifinitura responsive finale del workspace: ricerca coerente, focus lezione contestuale al posto del collasso globale, sidebar senza overflow orizzontale, indicatori distinti svolgimento/pool, tab e toolbar mobile stabili, tab Studenti/Classi a piena larghezza e tabella Verifiche mobile completamente scorribile. **Implementato.** | DUX-06C | Solo UI; nessuna modifica a service, dati, Rules, indici, query o costi Firebase. “Panoramica corso” resta disponibile. |
| DUX-07B ✅ | Editing dei metadati corso (anno, docente, materia, classe descrittiva, descrizione), con creazione controllata di `programma.md` quando assente. **Implementato.** | DUX-07A | Parser legacy-compatible; Storage prima del batch Firestore (`programmaMeta` + timestamp programma + audit); card e filtri anno aggiornati in memoria; nessuna modifica a Rules, indici o lato studente. |
| DUX-08 ✅ | Rifinitura azioni lezione (Segna svolta/non svolta + toggle struttura fuori dal menu "Azioni", con icone coerenti; struttura solo su desktop) e wrapping dei titoli lunghi nelle tabelle UDA/lezioni su mobile. **Implementato.** | DUX-07B | Solo UI; nessuna azione duplicata; nessuna modifica a service, Rules, schema, indici o costi; test mirati `CourseWorkspace`. |
| DUX-09 ✅ | Nuovo corso realmente inizializzato, apertura immediata e polish finale di Didattica/Verifiche e responsive. **Implementato.** | DUX-08, SGW-01 | `programma.md` + import vuoto coerente, batch Firestore, compensazione best-effort, test mirati; Rules e indici invariati. |
| DUX-10A ✅ | Stabilità e coerenza finali: “Nuova UDA” nelle azioni corso, geometria tabelle invariata durante Organizza, intestazioni export `UDA N: Titolo`, radius filtri Verifiche coerente. **Implementato.** | DUX-09 | Solo UI/export; nessuna modifica a service, Rules, schema, query o costi Firebase. |
| UI-DIDATTICA-01 ✅ | Le librerie corsi docente e studente adottano la stessa record card SchoolForge full-width, con superficie interamente apribile, metriche responsive e azioni accessibili separate. **Implementato.** | UI-SYSTEM-01 | Solo UI/UX: dati, filtri, ordinamento, query, listener, letture e scritture invariati. Una card per riga a 1440/1024/390/320 px; `UI-VERIFICHE` e la futura rifinitura dei metadati corso restano pacchetti separati. |
| UI-DIDATTICA-01A ✅ | Fix hover/focus della record card condivisa: overlay sempre trasparente con specificità locale, accento arancione e CTA decorativa «Apri programma →» solo su hover fine o focus-visible. **Implementato.** | UI-DIDATTICA-01 | Micro-fix esclusivamente visuale; contenuto e azioni restano visibili, touch e reduced-motion preservati, nessun impatto su Firebase o backend. |
| UI-DIDATTICA-01B ✅ | Record card condivisa più compatta su mobile: titolo identificativo azzurro/arancione, azioni in alto a destra e tre metriche sempre sulla stessa riga fino a 320 px. **Implementato.** | UI-DIDATTICA-01A | Rimossi eyebrow e dettaglio ridondante; progresso studente sotto le metriche, interazioni e operazioni Firebase invariate. |
| UI-BRAND-INTERACTIONS-01 ✅ | Standard cromatico opt-in SchoolForge: navigazione docente con blu stabile/arancione interattivo e icone metriche delle record card coordinate a titolo, bordo e accento. **Implementato.** | UI-DIDATTICA-01B | Solo CSS/test/documentazione; mobile e reduced-motion preservati, nessuna regola hover globale e nessun impatto su Firebase o backend. |
| UI-STUDENT-ALIGN-01 ✅ | Allineamento conservativo del portale studente: card corso senza tooltip nativo o azione Apri ridondante, lista Didattica senza ricerca passiva e header sullo stesso pattern interattivo condiviso del docente. **Implementato.** | UI-BRAND-INTERACTIONS-01 | Solo frontend: progresso coordinato su desktop, touch/reduced-motion preservati; nessuna nuova query, lettura, scrittura, dipendenza o modifica backend. |
| UI-VERIFICHE-01 ✅ | Archivio verifiche docente e tre sezioni studente convertiti alla record card SchoolForge full-width condivisa; creazione spostata nella toolbar con `DialogShell`, conferme archivio migrate a dialog condivisi. **Implementato.** | UI-BRAND-INTERACTIONS-01 | Una card per riga a 1440/1024/390/320 px; overlay solo per l’apertura neutra docente, azioni esplicite lato studente. La tabella consegne interna resta invariata; zero nuove query, letture, scritture, listener o costi Firebase. |
| UI-VERIFICHE-02 ✅ | Anatomia definitiva delle card docente: identità e azioni nella fascia superiore, quattro metriche Stato/Domande/Documento/Online sotto, metadati a cinque slot e switch interattivo indipendente dall’overlay. Dialog di creazione rifinito e titolo limitato autorevolmente a 100 caratteri. **Implementato.** | UI-VERIFICHE-01 | Eliminato lo stato arancione persistente causato dal focus interno; layout 4 metriche desktop e 2×2 mobile, nessuna nuova query, lettura, scrittura o modifica backend. |
| UI-VERIFICHE-06A ✅ | Pulizia delle card verifiche docente: metriche Stato/Online di dimensione uniforme e indipendente dal contenuto, CTA «Apri verifica →» visibile solo su hover reale o focus da tastiera della superficie apribile, sei azioni icona sostituite da un unico pulsante «Azioni» che riusa il menu portalato condiviso `ActionsMenu`. **Implementato.** | UI-VERIFICHE-05 | Solo presentazione, test e documentazione: handler, disabilitazioni e conferme delle sei azioni invariati, switch Online fuori dal menu; riquadro Argomenti, `topicOutline`, data verifica e proiezione studente restano non implementati (UI-VERIFICHE-06B). Zero nuove operazioni Firebase. |
| UI-VERIFICHE-06B ✅ | Data didattica della verifica (`verificationDate`, `YYYY-MM-DD`) e perimetro «Argomenti» privacy-safe (`topicOutline`: soli titoli UDA/lezione) propagati con coerenza a docente e studente: testata «02/02/2026 · Titolo · 6 Domande», terzo riquadro metrica cliccabile e popup condivisa `VerificationTopicsDialog` su `DialogShell`. La correzione restituita è **autosufficiente**: data e argomenti vi sono copiati dallo snapshot congelato alla restituzione, quindi restano leggibili anche a verifica chiusa o nascosta. **Implementato.** | UI-VERIFICHE-06A | Perimetro costruito dai dati già caricati e ricostruito autorevolmente all'attivazione (mai copiato dal client), congelato in snapshot, proiezione e correzione restituita; in VEX è l'unione delle lezioni e non rivela la variante assegnata. Legacy senza data/argomenti: data omessa, «Argomenti» disabilitato e spiegato, nessuna migrazione. **Costo:** zero costo passivo; zero letture all'apertura della popup; liste invariate; +2 query nell'apertura di una bozza e +2 nell'attivazione; numero di write invariato su salvataggio bozza e restituzione. |
| UI-RECORD-ACTIONS-01 ✅ | Menu «Azioni» condiviso e realmente operativo sulle card corso/verifica: gli handler React vengono eseguiti prima della chiusura del portale, le voci disabilitate restano inerti e la card conserva l’accento arancione mentre il menu è aperto. Rifiniti anche respiro del toggle Online, box metriche uniformi e data picker della nuova verifica. **Implementato.** | UI-VERIFICHE-06B | Solo UI/test/documentazione; nessuna nuova query, lettura, scrittura, dipendenza o modifica Firebase. Smoke Chromium reale sul componente condiviso oltre ai test unitari. |
| Gate GDUX ✅ | Verifica finale end-to-end di tutta la roadmap Didattica. **Superato (PASS)** — `evidenze/gdux-checklist-finale.md`. | DUX-01…10A (incl. 04A–D) | Checklist manuale DEV + evidenze automatiche, vedi §22. |

> **DUX-09 completato.** Il flusso “Nuovo corso” crea un import vuoto e un
> `programma.md` canonico tramite SGW, poi scrive programma/import/audit in un
> unico batch Firestore e apre subito il workspace. Il polish include anche
> colonne UDA/lezioni più leggibili, feedback svolgimento, toolbar Verifiche e
> stabilizzazione della dimensione del testo al cambio orientamento mobile.

---

*Documento companion: [prototipi/didattica-workspace.html](prototipi/didattica-workspace.html) — prototipo statico standalone per la revisione visiva del docente. Non collegato a nessun service reale, dati interamente inventati.*
