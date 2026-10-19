# Correzione IA: piani progressivi e cache del prompt

Contratto approvato il 19 ottobre 2026; issue #550. DEV autorizzato, PROD escluso.
Writer unico su `fix/ai-correction-batch-planning`; orchestratore responsabile di
review indipendente, merge, deploy mirato DEV e smoke. Nessun provider o secret
letto dall'implementatore.

## Problema osservato

I log tecnici PROD del 19 ottobre alle 07:52:43/56/57 UTC riportano
`aiCorrectionGateway`, fase preview, `limit_exceeded`. Il vecchio codice
aggregava count e token e la UI traduceva qualunque `resource-exhausted` come
«troppe consegne». La diagnosi non ha letto domande, risposte o correzioni PROD.
I nuovi codici distinguono numero di consegne, domande aperte e token della
singola consegna, token del gruppo, costo operazione, budget giornaliero e mensile.

## Piano e consenso

`aiCorrectionPlanPreview` valida fino a 2000 ID e rilegge l'eleggibilità dal
server. I limiti di `aiCorrectionRun` restano a 200 ID. Le letture del piano sono
memoizzate, con sei worker: una verifica e due letture per consegna. I gruppi
sono costruiti in ordine canonico secondo conteggio, token e prenotazione
prudenziale, con massimo una wave di concorrenza provider. Un singolo gruppo
non diventa una callable lunga quanto l'intera classe.

La stima è informativa. Il massimo autorizzabile copre payload UTF-8, output
massimo, revisore e retry; gli ID usati per stimare hanno la stessa lunghezza
dei figli eseguiti. Il totale somma i massimi dei gruppi. Il consenso include
esattamente massimo complessivo e massimo del gruppo; il server confronta
entrambi prima dell'esecuzione e impedisce prenotazioni superiori. Il ledger
esistente continua a prenotare atomicamente prima del provider: il piano non
aggira i budget giornaliero e mensile, né promette che altre operazioni non
consumeranno la disponibilità dopo la preview.

Se il budget non copre tutta la selezione, la preview espone la disponibilità
e gli ID di una selezione compatibile. La UI propone esplicitamente un nuovo
piano per quella selezione, con nuova stima e nuovo consenso. Le altre consegne
restano da correggere; nessuna riduzione avviene silenziosamente.

## Ripresa, race e privacy

`aiCorrectionPlanStatus` recupera il piano del docente autenticato;
`aiCorrectionPlanRunGroup` esegue un solo gruppo. Il checkpoint server conserva
ID, impostazioni applicate, hash delle fonti/configurazione, esiti e costi.
Non conserva domande, soluzioni, risposte, feedback o output integrali.
Nessun checkpoint è salvato nel browser. Le Rules negano accesso client alle
collezioni `aiCorrectionPlans` e `aiCorrectionPlanHeads`, anche al docente.

Il docente può fermarsi dopo il gruppo corrente o chiudere il dialog. Alla
riapertura trova i gruppi originali e i criteri originali; la ripresa richiede
un'azione esplicita. I gruppi completati sono restituiti senza rielaborazione.
Una risposta persa dopo la finalizzazione del figlio viene recuperata dal run
terminale usando hash della selezione e requestId originale.

Un gruppo con esito incerto rimane fenced: non parte una seconda invocazione.
Un nuovo piano, anche per una selezione disgiunta della stessa verifica, non
può nascondere quel checkpoint. Le transazioni sull'head serializzano cambio
di piano e avvio del gruppo. Un piano sostituito non può avviare altri gruppi.
Le fence per consegna del motore esistente restano attive.

Un errore provato prima della fence provider (per esempio budget consumato da
un'altra operazione) marca il gruppo `blocked`, non ambiguo: la UI propone una
nuova stima delle consegne rimanenti. Non tenta nuovamente il vecchio child con
lease ancora attiva. Errori con costo/esito incerto non vengono automaticamente
ripianificati. Gli esiti terminali parziali e falliti restano visibili.

Prima di ogni gruppo ancora da avviare il server confronta hash delle fonti,
modello, listino, criteri, contratto del prompt e configurazione/limiti. Qualunque
cambiamento o consenso più vecchio di 24 ore richiede nuova preview. Scadenza
del consenso e cancellazione del checkpoint sono distinte: non si configura
TTL per eliminare fence ancora necessarie al recupero di esiti incerti.

## Cache OpenAI

Per `gpt-6-luna` e `gpt-6.1-sol`, il primo messaggio developer contiene istruzioni,
domande esatte del sottoinsieme assegnato, soluzione di riferimento, difficoltà,
maxPoints, diagnostica numerica del riferimento e criteri. Un unico blocco
`input_text` termina con `prompt_cache_breakpoint: {mode: explicit}`; la richiesta
specifica `prompt_cache_options: {mode: explicit}`. Il messaggio user successivo
contiene risposte, diagnostica delle risposte, contesto, proposta del primo
correttore e ID. Questi dati non sono nel prefisso riutilizzabile.

Grader e reviewer hanno prefissi distinti. Due studenti con lo stesso esatto
sottoinsieme e criteri condividono il prefisso, ma ricevono due valutazioni
indipendenti. Nessun punteggio o feedback viene riutilizzato tra studenti.
Restano `store: false`, nessuno strumento esterno e i guardrail precedenti.

La [documentazione ufficiale sulla cache](https://developers.openai.com/api/docs/guides/prompt-caching)
richiede almeno 1024 token per l'idoneità. Le istruzioni comuni non vengono
riempite con risposte degli studenti. La cache è un'ottimizzazione, non una
garanzia di risparmio: prenotazioni e fallback accounting usano la tariffa
cache-write più prudente; le metriche reali cached/write vengono mantenute
quando il provider le rende disponibili.

## Verifica e rilascio

Test dedicati coprono piano oltre 200 selezioni, limiti per item/gruppo,
massimi del consenso, budget complessivo e subset esplicito, replay, ripresa,
avvii concorrenti, risposta persa, fonte/config/scadenza, owner, fence ambigue e
assenza di contenuti privati nei checkpoint. Test con emulatore esercitano le
transazioni head e le Rules server-only. Test UI coprono progresso, stop,
chiusura/ripresa, criteri originali, subset e cambio della sessione autenticata.

L'orchestratore ha collaudato nel browser 35 consegne/12 gruppi con risposta
persa dopo il secondo gruppo, chiusura e reload: 35/35, 12 invocazioni uniche;
proposta budget di 10 consegne e successiva conferma; stop dopo il primo gruppo;
profilo Qualità e guidance originali dopo reload; mobile 360×800 senza overflow.
Le callable erano simulate, senza dati scolastici o provider.

Gate richiesti: format, lint, typecheck, test, build, test:rules, diff check, CI
e review indipendente. Deploy DEV mirato: hosting e le cinque callable
`aiCorrectionPreview`, `aiCorrectionRun`, `aiCorrectionPlanPreview`,
`aiCorrectionPlanStatus`, `aiCorrectionPlanRunGroup`. Rollback tramite lo SHA
precedente del solo codice applicativo, mantenendo i checkpoint non terminali.
Smoke reale con dati sintetici e budget autorizzato separatamente gestito
dall'orchestratore. Nessun deploy PROD autorizzato.
