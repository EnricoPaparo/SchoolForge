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

  it('nessuna textarea ridimensionabile e nessun separatore sopra i pulsanti', () => {
    expect(dialog).not.toContain('<textarea');
    expect(lessonDialog).not.toContain('<textarea');
    expect(body).not.toMatch(/border-top/);
    const actions = css.slice(css.indexOf('.dialogActions {'));
    expect(actions.slice(0, actions.indexOf('}'))).not.toMatch(/border-top/);
  });
});

describe('conformità del dialog', () => {
  it('usa DialogShell, che porta viewport, scroll interno e chiusura sicura', () => {
    expect(dialog).toContain("import { DialogShell } from '../../components/DialogShell.js'");
    expect(dialog).toContain('<DialogShell title="Importa struttura UDA"');
    expect(lessonDialog).toContain('<DialogShell title="Importa lezioni"');
    expect(lessonDialog).toContain('busy={busy}');
    // `busy` è ciò che DialogShell usa per bloccare Escape e backdrop.
    expect(dialog).toContain('busy={busy}');
  });

  it('non introduce dimensioni fisse che uscirebbero dalla viewport', () => {
    expect(body).not.toMatch(/(^|[^-])width:\s*\d/);
    expect(body).not.toMatch(/min-width:\s*\d/);
  });
});
