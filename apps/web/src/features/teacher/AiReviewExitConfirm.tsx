/**
 * AIGEN-UI-03-FOLLOW-UP — conferma di uscita dalla revisione di una proposta IA,
 * condivisa dal dialog pool e dal dialog lezione (markup identico, un solo
 * punto di verità). Inline, con lo stesso pattern `role="alert"` della conferma
 * di applicazione: **nessun dialog annidato**.
 *
 * Tre azioni esplicite, tutte senza callable, write o costo:
 * - «Continua la revisione» → chiude solo la conferma, proposta e modifiche
 *   locali restano intatte;
 * - «Modifica configurazione» → scarta la proposta e torna alla fase di
 *   configurazione **senza chiudere il dialog**, conservando le impostazioni già
 *   scelte dal docente (profilo, stile/profondità, quantità, indicazioni);
 * - «Abbandona e chiudi» → unico percorso che invoca `onClose`, distruttivo.
 *
 * Il layout usa `dialog-actions`, che sotto i 480px porta ogni pulsante a tutta
 * larghezza: a 390 e 320 px le tre azioni si impilano in modo ordinato, senza
 * overflow né testo troncato.
 */
export function AiReviewExitConfirm({
  onKeepReviewing,
  onBackToConfigure,
  onAbandon,
}: {
  onKeepReviewing: () => void;
  onBackToConfigure: () => void;
  onAbandon: () => void;
}) {
  return (
    <div role="alert">
      <p>Abbandonare la proposta generata? Le modifiche non applicate andranno perse.</p>
      <div className="dialog-actions">
        <button type="button" onClick={onKeepReviewing}>
          Continua la revisione
        </button>
        <button type="button" onClick={onBackToConfigure}>
          Modifica configurazione
        </button>
        <button type="button" className="btn-danger" onClick={onAbandon}>
          Abbandona e chiudi
        </button>
      </div>
    </div>
  );
}
