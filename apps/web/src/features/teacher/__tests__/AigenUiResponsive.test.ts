import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AIGEN-UI-02 — contratto CSS di viewport/scroll/responsive. jsdom non calcola il
 * layout né applica i CSS Modules, quindi queste garanzie (altezza legata a
 * `dvh`, scroll interno, scrollbar nascosta ma **non** disabilitata, toolbar
 * lezione a due colonne su mobile) sono verificate sul foglio di stile, come già
 * fatto per la toolbar di `VerificationsView`.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const dialogShell = read('src/components/DialogShell.module.css');
const aigen = read('src/features/teacher/AiPoolGenerationDialog.module.css');
const workspace = read('src/features/teacher/CourseWorkspace.module.css');
const stepper = read('src/features/teacher/QuestionCountStepper.module.css');
const poolEditor = read('src/features/teacher/QuestionPoolEditor.module.css');

describe('AIGEN dialog viewport containment', () => {
  it('bounds the wide-scroll variant to the dynamic viewport with internal vertical scroll', () => {
    const block = dialogShell.match(/\.dialog\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(block).toMatch(/max-height:\s*calc\(100dvh\s*-\s*2rem\)/);
    expect(block).toMatch(/overflow-y:\s*auto/);
    expect(block).toMatch(/overflow-x:\s*hidden/);
    expect(block).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('keeps a bounded max-width so the dialog never becomes huge on desktop', () => {
    expect(dialogShell).toMatch(/\.dialogWideScroll\s*\{[^}]*width:\s*min\(100%,\s*35rem\)/s);
  });
});

describe('AIGEN scrollbars are hidden, never disabled', () => {
  it('hides the dialog scrollbar on Firefox and WebKit without touching overflow', () => {
    const block = dialogShell.match(/\.dialog\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(block).toMatch(/scrollbar-width:\s*none/);
    expect(dialogShell).toMatch(/\.dialog::-webkit-scrollbar\s*\{[^}]*width:\s*0/s);
    // Lo scorrimento resta attivo: nessun overflow:hidden sull'asse verticale.
    expect(block).not.toMatch(/overflow-y:\s*hidden/);
    expect(block).not.toMatch(/overflow:\s*hidden/);
  });

  it('hides the review list and guidance textarea scrollbars while keeping overflow-y auto', () => {
    expect(aigen).toMatch(/\.reviewList\s*\{[^}]*overflow-y:\s*auto/s);
    expect(aigen).toMatch(/\.guidanceTextarea\s*\{[^}]*overflow-y:\s*auto/s);
    expect(aigen).toMatch(/scrollbar-width:\s*none/);
    expect(aigen).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*0/s);
  });

  it('does not introduce any global scrollbar rule', () => {
    // Le regole di nascondimento sono sempre qualificate da una classe locale.
    for (const css of [dialogShell, aigen]) {
      for (const sel of css.match(/^[^{}]*::-webkit-scrollbar[^{]*\{/gm) ?? []) {
        expect(sel).toMatch(/\./);
      }
    }
  });
});

describe('AIGEN guidance textarea', () => {
  it('keeps a sober initial height and internal scroll', () => {
    const block = aigen.match(/\.guidanceTextarea\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(block).toMatch(/min-height:/);
    expect(block).toMatch(/max-height:/);
    expect(block).toMatch(/overflow-y:\s*auto/);
    // Il divieto di resize è globale (index.css) — vedi `textareaResize.test.ts`.
    expect(block).not.toMatch(/resize:/);
  });
});

describe('POOL-ROLLOUT-01 fixed Quality profile', () => {
  it('keeps the informative profile panel compact and wrappable on narrow viewports', () => {
    const block = aigen.match(/\.fixedProfile\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(block).toMatch(/display:\s*flex/);
    expect(block).toMatch(/flex-wrap:\s*wrap/);
    expect(block).toMatch(/gap:/);
    expect(block).not.toMatch(/width:\s*\d+px/);
    expect(block).not.toMatch(/min-width:/);
  });
});

describe('AIGEN review card compact metadata row', () => {
  it('lays the metadata row out inline with an ordered wrap', () => {
    expect(aigen).toMatch(/\.reviewHead\s*\{[^}]*display:\s*flex/s);
    expect(aigen).toMatch(/\.reviewHead\s*\{[^}]*flex-wrap:\s*wrap/s);
    // AIGEN-UI-03 — riga 2 dedicata ai metadati, con wrap ordinato su mobile.
    expect(aigen).toMatch(/\.reviewMeta\s*\{[^}]*display:\s*flex/s);
    expect(aigen).toMatch(/\.reviewMeta\s*\{[^}]*flex-wrap:\s*wrap/s);
  });

  it('aligns the delete button height with the inline steppers', () => {
    expect(aigen).toMatch(/\.reviewDeleteBtn\s*\{[^}]*height:\s*2rem/s);
    expect(stepper).toMatch(/\.stepperInline \.control\s*\{[^}]*height:\s*2rem/s);
  });

  it('avoids horizontal overflow in the option rows', () => {
    expect(aigen).toMatch(/\.opzioneRow input\[type='text'\]\s*\{[^}]*min-width:\s*0/s);
  });

  it('keeps «Elimina» on the header row, shrinking to the icon only under 420px', () => {
    const mobile = aigen.match(/@media \(max-width: 640px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    // Spinto a destra della prima riga, mai su una riga propria.
    expect(mobile).toMatch(/\.reviewDeleteBtn\s*\{[^}]*margin-left:\s*auto/s);
    expect(aigen).toMatch(
      /@media \(max-width: 420px\)[\s\S]*?\.reviewDeleteLabel\s*\{[^}]*display:\s*none/,
    );
  });

  it('makes the review textareas internally scrollable and width-bounded', () => {
    const block = aigen.match(/\.reviewTextarea\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(block).toMatch(/overflow-y:\s*auto/);
    expect(block).toMatch(/max-width:\s*100%/);
    // Il divieto di resize è globale (index.css) — vedi `textareaResize.test.ts`.
    expect(block).not.toMatch(/resize:/);
  });

  it('gives the wide stepper room for at least five digits (10000 never truncated)', () => {
    const block = stepper.match(/\.stepperWide \.input\s*\{[^}]*\}/s)?.[0] ?? '';
    const width = /width:\s*(\d+)ch/.exec(block);
    expect(width).not.toBeNull();
    expect(Number(width![1])).toBeGreaterThanOrEqual(5);
    // Su mobile il campo prende tutto lo spazio rimasto nella cella della griglia.
    expect(stepper).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.stepperInline \.input,\s*\.stepperInline\.stepperWide \.input\s*\{[^}]*flex:\s*1 1 0/,
    );
  });

  it('gives both review steppers full, non-shrinking mobile grid cells', () => {
    expect(aigen).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.reviewMeta\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(aigen).toMatch(/@media \(max-width: 360px\)[\s\S]*?grid-template-columns:\s*1fr/);
    expect(stepper).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.stepperInline \.control\s*\{[^}]*width:\s*100%[^}]*height:\s*2\.75rem/,
    );
  });

  it('lets the inline stepper honour its flex-basis (no min-content clamp from the global button)', () => {
    // Senza `padding: 0`/`min-width: 0` il `min-width: auto` del flex item
    // riporterebbe i pulsanti alla larghezza min-content, facendo debordare la
    // riga metadati su mobile (rilevato nello smoke a 320px).
    expect(stepper).toMatch(/\.button\s*\{[^}]*padding:\s*0;/s);
    expect(stepper).toMatch(/\.button\s*\{[^}]*min-width:\s*0/s);
  });
});

describe('lesson toolbar on mobile', () => {
  it('keeps «Azioni» and «Segna svolta» side by side in two columns under 640px', () => {
    const mobile = workspace.match(/@media \(max-width: 640px\)\s*\{[\s\S]*$/)?.[0] ?? '';
    expect(mobile).toMatch(/\.toolbarLesson\s*\{[^}]*grid-template-columns:\s*1fr 1fr/s);
    // L'override neutralizza il full-width del menuWrap che mandava a capo.
    expect(mobile).toMatch(/\.toolbarLesson > \.menuWrap\s*\{[^}]*flex:\s*initial/s);
    expect(mobile).toMatch(/\.toolbarLesson > \.menuWrap > button[\s\S]{0,80}width:\s*100%/);
  });

  it('leaves the generic course/UDA toolbars on their previous full-width behaviour', () => {
    const mobile = workspace.match(/@media \(max-width: 640px\)\s*\{[\s\S]*$/)?.[0] ?? '';
    expect(mobile).toMatch(/\.toolbar > \.menuWrap\s*\{[^}]*flex:\s*1 1 100%/s);
  });
});

describe('pool question metadata group (Dim. risposta)', () => {
  it('keeps difficulty and answer size in one group that wraps in an orderly way', () => {
    const block = poolEditor.match(/\.questionMetaGroup\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(block).toMatch(/display:\s*flex/);
    // Desktop: stessa riga; schermi stretti: wrap ordinato, nessun overflow.
    expect(block).toMatch(/flex-wrap:\s*wrap/);
    expect(block).toMatch(/min-width:\s*0/);
    // L'allineamento a destra si è spostato dal singolo meta al gruppo.
    expect(block).toMatch(/margin-left:\s*auto/);
    expect(poolEditor).not.toMatch(/\.questionMeta\s*\{[^}]*margin-left:\s*auto/s);
  });
});

describe('pool action toolbar on mobile', () => {
  it('places the count on its own row and the four actions in an equal 2 × 2 grid', () => {
    const mobile =
      poolEditor.match(
        /@media \(max-width: 640px\)[\s\S]*?\.poolMetaActions > button\s*\{[^}]*\}/,
      )?.[0] ?? '';
    expect(mobile).toMatch(
      /\.poolMeta\s*\{[^}]*flex-direction:\s*column[^}]*align-items:\s*stretch/s,
    );
    expect(mobile).toMatch(/\.poolMetaActions\s*\{[^}]*display:\s*grid/s);
    expect(mobile).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(mobile).toMatch(
      /\.poolMetaActions > button\s*\{[^}]*width:\s*100%[^}]*min-height:\s*2\.75rem/s,
    );
  });
});

describe('lesson generation choices on mobile', () => {
  it('allows profile and depth descriptions to wrap inside the dialog', () => {
    const choice = aigen.match(/\.choice\s*\{[^}]*\}/s)?.[0] ?? '';
    const meta = aigen.match(/\.choiceMeta\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(choice).toMatch(/min-width:\s*0/);
    expect(choice).toMatch(/max-width:\s*100%/);
    expect(choice).toMatch(/white-space:\s*normal/);
    expect(meta).toMatch(/overflow-wrap:\s*anywhere/);
    expect(aigen).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.choice\s*\{[^}]*flex-basis:\s*100%[^}]*width:\s*100%/,
    );
  });
});
