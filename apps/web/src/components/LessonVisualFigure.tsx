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
 * **Lo spazio è riservato prima dei byte.** Il frame ha `aspect-ratio` calcolato
 * da `width`/`height` del manifest, che il server ha verificato contro
 * l'immagine reale. Quando i byte arrivano cambia solo il **contenuto** del
 * frame, non la sua geometria: niente salto della pagina, niente CLS. È anche
 * la ragione per cui la figura viene montata subito, con il solo manifest.
 *
 * Con `src` a `null` non viene creata alcuna `<img>`: un elemento con `src`
 * vuoto è un'immagine rotta, e il browser la disegna come tale.
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
  status,
}: {
  /** Data URI `image/webp` **già verificato**, oppure `null` finché non c'è. */
  src: string | null;
  altText: string;
  caption: string;
  width: number;
  height: number;
  /**
   * `loading` mentre i byte sono in volo, `unavailable` quando non arriveranno.
   * In entrambi i casi lo spazio resta riservato: la lezione non deve
   * riorganizzarsi sotto gli occhi di chi la sta leggendo.
   */
  status: 'ready' | 'loading' | 'unavailable';
}) {
  return (
    <figure className={styles.figure}>
      <div
        className={styles.frame}
        // `aspect-ratio` inline perché dipende dal manifest, non dal foglio di
        // stile: è l'unico modo di riservare lo spazio esatto di *questa*
        // immagine prima di averla.
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        {src !== null ? (
          <img
            className={styles.image}
            src={src}
            alt={altText}
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
          />
        ) : (
          /*
           * Placeholder neutro e **non animato**: un'animazione su un blocco
           * grande quanto una figura è rumore visivo mentre si legge, e su
           * `prefers-reduced-motion` sarebbe da disattivare comunque.
           *
           * Il messaggio di stato sta **dentro** il frame, non sotto: una riga
           * di testo sotto la figura occuperebbe spazio proprio, e sparendo
           * all'arrivo dei byte sposterebbe di ~27 px tutto il contenuto
           * successivo — cioè esattamente il salto che riservare lo spazio
           * doveva evitare. Misurato in Chromium prima di correggerlo.
           */
          <div className={styles.placeholder}>
            <p className={styles.status} role="status">
              {status === 'unavailable' ? 'Immagine non disponibile.' : 'Immagine in caricamento…'}
            </p>
          </div>
        )}
      </div>
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  );
}
