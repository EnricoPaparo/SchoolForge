import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * STRUCTURE-IMPORT-02A — contratto di layout del riepilogo.
 *
 * Con molte UDA l'elenco riempirebbe il dialog e spingerebbe i comandi fuori
 * dalla viewport: misurato in Chromium a 1440/1024/390/320, il pulsante di
 * conferma risultava davvero irraggiungibile prima di questa regola. La
 * soluzione è quella già usata da `.checklist`: è l'elenco a scorrere, non il
 * dialog, e su schermi bassi cede altezza per primo.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, '../DidatticaView.module.css'), 'utf8');
const dialog = readFileSync(resolve(__dirname, '../ImportUdaStructureDialog.tsx'), 'utf8');
const lessonDialog = readFileSync(resolve(__dirname, '../ImportLessonStructureDialog.tsx'), 'utf8');

const rule = css.slice(css.indexOf('.structureSummary {'));
const body = rule.slice(0, rule.indexOf('}'));

describe('elenco di riepilogo', () => {
  it('scorre dentro di sé invece di far crescere il dialog', () => {
    expect(body).toMatch(/max-height:\s*38vh/);
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('su schermi bassi riduce ulteriormente la propria altezza', () => {
    const query = css.slice(css.indexOf('@media (max-height: 45rem)'), css.length).slice(0, 220);
    expect(query).toContain('.structureSummary');
    expect(query).toMatch(/max-height:\s*24vh/);
  });

  it('la classe è applicata proprio all’elenco del riepilogo', () => {
    expect(dialog).toContain('styles.structureSummary');
  });

  it('i comandi restano fuori dall’area che scorre', () => {
    expect(dialog.indexOf('styles.dialogActions')).toBeGreaterThan(dialog.indexOf('</ol>'));
    expect(lessonDialog.indexOf('styles.dialogActions')).toBeGreaterThan(
      lessonDialog.indexOf('</ol>'),
    );
  });

  it('i comandi sono ancorati in fondo al dialog, in entrambi gli import', () => {
    // Limitare l'elenco non basta su schermi molto bassi: misurato a 320x640,
    // il pulsante di conferma finiva sotto la piega.
    const actions = css.slice(css.indexOf('.structureActions {'));
    const actionsBody = actions.slice(0, actions.indexOf('}'));
    expect(actionsBody).toMatch(/position:\s*sticky/);
    expect(actionsBody).toMatch(/bottom:\s*-1\.25rem/);
    // Nessuna linea separatrice sopra i pulsanti.
    expect(actionsBody).not.toMatch(/border/);
    expect(dialog).toContain('styles.structureActions');
    expect(lessonDialog).toContain('styles.structureActions');
  });

  it('nessun separatore sopra i pulsanti', () => {
    expect(body).not.toMatch(/border-top/);
    const actions = css.slice(css.indexOf('.dialogActions {'));
    expect(actions.slice(0, actions.indexOf('}'))).not.toMatch(/border-top/);
  });
});

/**
 * STRUCTURE-IMPORT-UI-PASTE-01 — contratto della textarea in cui si incolla lo
 * YAML. Sono vincoli che nessun test funzionale può vedere: jsdom non calcola
 * layout, quindi «non ridimensionabile», «monospace» e «scorre dentro di sé»
 * vivono nel CSS e vanno verificati lì.
 */
describe('area di incollaggio', () => {
  const textarea = css.slice(css.indexOf('.structureTextarea {'));
  const textareaBody = textarea.slice(0, textarea.indexOf('}'));

  it('occupa la larghezza disponibile senza mai eccederla', () => {
    expect(textareaBody).toMatch(/width:\s*100%/);
    // Nessuna larghezza fissa: è ciò che produrrebbe overflow a 320 px.
    expect(textareaBody).not.toMatch(/(^|[^-])width:\s*\d+(px|rem|em|ch)/);
    expect(textareaBody).not.toMatch(/min-width:\s*\d/);
  });

  it('scorre dentro di sé invece di far crescere il dialog', () => {
    expect(textareaBody).toMatch(/max-height:\s*42vh/);
    expect(textareaBody).toMatch(/overflow-y:\s*auto/);
    expect(textareaBody).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('su schermi bassi cede altezza, restando utilizzabile', () => {
    const query = css.slice(css.indexOf('@media (max-height: 45rem)'));
    const block = query.slice(0, query.indexOf('\n}'));
    expect(block).toContain('.structureTextarea');
    expect(block).toMatch(/max-height:\s*30vh/);
  });

  it('usa il font monospace del design system: in YAML l’indentazione è sintassi', () => {
    expect(textareaBody).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(textareaBody).toMatch(/white-space:\s*pre/);
  });

  it('non ridichiara `resize`: la regola globale resta l’unica autorevole', () => {
    // `index.css` impone `textarea { resize: none }` e un test statico dedicato
    // lo difende; ridichiararlo qui creerebbe una seconda fonte di verità.
    expect(textareaBody).not.toMatch(/resize/);
    expect(css).not.toMatch(/\.structureTextarea[^}]*resize/);
  });

  it('la classe è applicata alla textarea di entrambi i dialog', () => {
    for (const source of [dialog, lessonDialog]) {
      expect(source).toContain('styles.structureTextarea');
      expect(source).toContain('<textarea');
    }
  });
});

/**
 * STRUCTURE-IMPORT-UI-PASTE-01 — il percorso non torna a leggere file.
 *
 * Il valore di questa prova è che è statica: un `input type="file"` o un
 * `FileReader` reintrodotti più avanti sarebbero invisibili ai test funzionali
 * finché qualcuno non li usa, e a quel punto la lettura permissiva sarebbe già
 * nel percorso autorevole.
 */
describe('nessuna lettura di file nel percorso', () => {
  it('nessun input file, drag and drop o API permissiva di lettura', () => {
    for (const source of [dialog, lessonDialog]) {
      for (const forbidden of [
        'type="file"',
        'accept=',
        'FileReader',
        '.text()',
        'arrayBuffer',
        'onDrop',
        'onDragOver',
        'dataTransfer',
        'URL.createObjectURL',
        'download',
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it('la codifica passa da TextEncoder e finisce nel validatore già esistente', () => {
    for (const [source, validator] of [
      [dialog, 'validateUdaMetadataFile'],
      [lessonDialog, 'validateLessonMetadataFile'],
    ] as const) {
      const encode = source.indexOf('new TextEncoder().encode(yaml)');
      const validate = source.indexOf(`${validator}(bytes)`);
      expect(encode).toBeGreaterThan(-1);
      // L'ordine è vincolante: prima i byte, poi il validatore byte-first.
      expect(validate).toBeGreaterThan(encode);
      // Nessun parser o validatore parallelo introdotto qui.
      expect(source).not.toContain('parseStructureYaml');
      expect(source).not.toContain('MetadataFileText');
      expect(source.split(validator).length - 1).toBe(2);
    }
  });
});

describe('conformità del dialog', () => {
  it('usa DialogShell, che porta viewport, scroll interno e chiusura sicura', () => {
    expect(dialog).toContain("import { DialogShell } from '../../components/DialogShell.js'");
    expect(dialog).toContain('title="Importa struttura UDA"');
    expect(lessonDialog).toContain('title="Importa lezioni"');
    // `wide-scroll` è una variante già esistente del design system: lo YAML ha
    // bisogno di larghezza, ma non di un dialog su misura.
    for (const source of [dialog, lessonDialog]) {
      expect(source).toContain('variant="wide-scroll"');
    }
    expect(lessonDialog).toContain('busy={busy}');
    // `busy` è ciò che DialogShell usa per bloccare Escape e backdrop.
    expect(dialog).toContain('busy={busy}');
  });

  it('non introduce dimensioni fisse che uscirebbero dalla viewport', () => {
    expect(body).not.toMatch(/(^|[^-])width:\s*\d/);
    expect(body).not.toMatch(/min-width:\s*\d/);
  });
});
