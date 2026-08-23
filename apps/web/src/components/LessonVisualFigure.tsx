import styles from './LessonVisualFigure.module.css';

/**
 * VISUAL-ENRICHMENT-04A — l'unica illustrazione approvata di una lezione.
 *
 * **Non è HTML.** `caption` e `altText` arrivano come testo React, quindi non
 * esiste alcun punto in cui un contenuto scritto dal docente possa diventare
 * markup: né prima né dopo la sanificazione, perché qui non si sanifica nulla —
 * non c'è niente da sanificare. È il motivo per cui la figura è un componente e
 * non un frammento di HTML iniettato nel corpo.
 *
 * `width` e `height` vengono dal manifest e sono **obbligatori**: senza, il
 * browser non conosce il rapporto d'aspetto prima di aver scaricato l'immagine
 * e la pagina salta quando arriva. Con essi, e con `height: auto` nel CSS, lo
 * spazio è riservato dal primo paint.
 *
 * Nessun lightbox, zoom, carosello o animazione: un'illustrazione didattica si
 * guarda, non si esplora.
 */
export function LessonVisualFigure({
  src,
  altText,
  caption,
  width,
  height,
}: {
  /** Data URI `image/webp` **già verificato** dal chiamante. */
  src: string;
  altText: string;
  caption: string;
  width: number;
  height: number;
}) {
  return (
    <figure className={styles.figure}>
      <img
        className={styles.image}
        src={src}
        alt={altText}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
      />
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  );
}
