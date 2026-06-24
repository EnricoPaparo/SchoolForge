# SchoolForge

Repository didattico personale Markdown-first per un solo docente. Le lezioni e i pool di domande sono la conoscenza canonica; SchoolForge li usa per presentare contenuti, generare verifiche, raccogliere consegne digitali e supportare la correzione manuale.

## Stato

La baseline documentale v3.2 è coerente e pronta per il bootstrap controllato. Non esiste ancora codice applicativo, configurazione Firebase o pipeline eseguibile: il primo pacchetto da implementare è `F-01 — Workspace e CI`.

## Principi non negoziabili

- Markdown e asset restano esportabili senza SchoolForge.
- La V1 ha un solo docente e nessun account studente.
- L'email studente è un recapito per il canale cartaceo, non un'identità verificata né un limite di tentativo.
- Il limite di un tentativo per verifica usa nome e cognome dichiarati e normalizzati; non prova l'identità dello studente.
- I PDF cartacei e gli export sono generati on-demand e non conservati dal sistema.
- Il Portale digitale salva uno snapshot della prova realmente svolta.
- L'AI è opzionale, non genera domande e non usa fonti web.
- Firebase è la piattaforma; costi e componenti restano minimi, con scale-to-zero e avvisi budget.

## Percorso documentale

| Documento | Funzione |
|---|---|
| [Brief](documentazione/brief.md) | Visione, perimetro e decisioni del prodotto. |
| [Requisiti](documentazione/analisi-requisiti.md) | Regole funzionali, qualità e criteri di accettazione. |
| [Architettura](documentazione/architettura.md) | Firebase, dati, sicurezza, backup e flussi tecnici. |
| [Piano di implementazione](documentazione/piano-implementazione.md) | Pacchetti per agenti, dipendenze, gate e attività umane. |
| [Contratto API](documentazione/api-contract.md) | Endpoint logici e autorizzazione prevista. |
| [Contratto di importazione](documentazione/contratto-importazione.md) | Struttura sorgente, identificatori stabili, limiti e commit dell'import. |
| [Stati e invarianti](documentazione/stati-e-invarianti.md) | Macchine a stati, lock del tentativo, reset e regole di concorrenza. |
| [Sicurezza](documentazione/sicurezza.md) | Controlli, minacce e gate di sicurezza. |
| [Strategia di test](documentazione/test-strategy.md) | Evidenze minime per ciascun modulo. |
| [Glossario](documentazione/glossario.md) | Vocabolario condiviso. |
| [Guida per l'agente di coding](documentazione/guida-agente-coding.md) | Ordine di lettura, confini e handoff obbligatorio. |
| [Diagrammi](documentazione/diagrammi) | Dettaglio di dati e flussi principali. |

## Moduli di delivery

1. Repository didattico.
2. Verifiche cartacee, invio email e limite per nome/cognome dichiarati.
3. Portale digitale con snapshot e consegna.
4. Correzione manuale ed export globale delle verifiche svolte.
5. Correzione AI opzionale.

Il progetto può fermarsi dopo ogni modulo mantenendo un prodotto utile.

## Firebase ed esercizio

Il Docente possiede progetto e billing Firebase. Firestore, Storage e Functions usano Milano `europe-west8` dove supportato. Backup giornaliero, conservazione minima 30 giorni, RPO 24 ore e restore best-effort sono definiti in C-01.

## Prossimo passo

Completare H-01, H-02 e H-08 del piano: creare i progetti Firebase `dev` e `prod`, abilitare billing Blaze, definire le risorse dati nella regione prevista e scegliere il provider di accesso del docente. In parallelo un agente può iniziare F-01, senza deploy o segreti di produzione.
