# Audit affidabilità generazione IA — DEV

Data: 5 ottobre 2026. Issue #516, PR #517.

## Evidenze e cause distinte

- Il pool Quality termina due volte con `provider_unavailable` dopo 121835 e
  121942 ms. La policy prevedeva due tentativi da 60 secondi: durata compatibile
  con il limite, senza poter attribuire univocamente la causa dal vecchio log.
- Diverse lezioni terminano correttamente in 118–176 secondi, seguite da revisioni
  riuscite. Successivamente lezione, revisore e piano immagini falliscono in
  3–6 secondi: questi errori non sono spiegati da timeout lunghi.
- Tre chiamate diagnostiche minime autorizzate con la chiave DEV esistente,
  senza dati scolastici e senza retry, ricevono HTTP 429. L'ultima identifica
  precisamente `credit_balance_exhausted` su GPT-5.6 Luna. La prima su GPT-6.1 Sol
  restituisce 429. Nessuna generazione diagnostica completa è stata eseguita.
- Il credito prepagato API richiede intervento sull'account: un deploy o un retry
  non lo ripristina. Non sono stati eseguiti pagamenti o modifiche ai limiti.
- Il testo esatto dell'errore immagini segnalato non è disponibile. Non viene
  attribuito a una race non dimostrata. È invece dimostrato un difetto nel retry
  di `visual_promotion_anchor_stale`.

## Correzioni

1. Pool: timeout per tentativo di 180 secondi; configurazione opzionale
   `poolAttemptTimeoutMs` accetta solo interi 1–180000. Numero di retry invariato.
2. Lease: include il massimo fra backoff e `Retry-After`. Con due tentativi lunghi
   vale 398 secondi, compresi 20 secondi di finalizzazione; server 420 e client 450.
3. Errori provider: diagnostica chiusa `{category, httpStatus}` su testo e immagini,
   senza messaggi raw, header, chiavi, prompt, identificativi o contenuti.
4. Credito, spesa e quota esauriti: nessun retry automatico inutile. Il normale
   rate limit resta transitorio. Accounting e prenotazione rimangono invariati.
5. Revisione nella generazione normale: `unchanged` conserva byte per byte la bozza
   base, anche dopo retry, come già avviene nella generazione completa.
6. Ancora immagini obsoleta: interrompe gli slot successivi, non propone retry
   sul piano invalido e mostra un messaggio specifico. Nessuna promessa di creare
   automaticamente un nuovo piano mentre il precedente è ancora attivo.

I codici di fatturazione correnti sono verificati sulla
[documentazione ufficiale degli errori OpenAI](https://developers.openai.com/api/docs/guides/error-codes).

## Gate e limiti

Test locali senza rete verificano timeout, parsing, lease, SDK reale con trasporto
fittizio, privacy dei log, retry quota contro rate limit, stato della revisione e
interruzione del piano con ancora obsoleta. Review indipendente e CI completa
precedono il deploy DEV. Nessun deploy PROD.

La prova completa autenticata resta necessaria dopo il ripristino del credito
API: lezioni normali con e senza indicazioni, completo con revisore ON/OFF,
recupero da mappa/pool/immagini, applicazione e posizione delle immagini.
