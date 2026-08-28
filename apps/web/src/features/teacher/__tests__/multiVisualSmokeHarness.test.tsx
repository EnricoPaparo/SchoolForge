import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LessonVisualItem } from '../../../types/firestore.js';
import { LessonMultiVisualGallery } from '../LessonMultiVisualGallery.js';

const root = resolve(process.cwd(), 'src/features/teacher');

function item(index: number): LessonVisualItem {
  const assetId = `${index}1111111-1111-4111-8111-111111111111`;
  return {
    assetId,
    anchor: {
      headingSlug: `sezione-${index}`,
      headingText: `Sezione ${index}`,
      placement: 'after-heading',
    },
    caption: `Didascalia molto lunga ${index} che deve andare a capo senza allargare la pagina`,
    altText: `Schema ${index}`,
    width: 1024,
    height: 768,
    storageRef: `repository/owner/import/uda/visuals/${assetId}.webp`,
    byteLength: 100,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp',
    source: 'generated',
    styleVersion: 'schoolforge-sketch/v1',
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: { toMillis: () => 1 } as never,
  };
}

describe('MULTI-VISUAL-04 — smoke harness CSS reale', () => {
  it('monta tre card reali senza larghezze rigide nel markup', () => {
    const { container } = render(
      <LessonMultiVisualGallery
        identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
        manifest={[item(1), item(2), item(3)]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('article')).toHaveLength(3);
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
    expect(container.innerHTML).not.toMatch(/style="[^"]*(?:width|min-width):\s*\d+px/);
  });

  it('congela layout fluido desktop/tablet e fallback mobile fino a 320px', () => {
    const gallery = readFileSync(resolve(root, 'LessonMultiVisualGallery.module.css'), 'utf8');
    const dialog = readFileSync(
      resolve(root, 'LessonMultiVisualWorkflowDialog.module.css'),
      'utf8',
    );
    expect(gallery).toMatch(/repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(gallery).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*grid-template-columns:\s*1fr/);
    expect(dialog).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*min-height:\s*44px/);
    expect(dialog).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*\.currentItem\s*\{[\s\S]*flex-direction:\s*column/,
    );
    expect(gallery).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*min-height:\s*44px/);
    expect(`${gallery}\n${dialog}`).not.toMatch(/overflow-x:\s*(?:scroll|auto)/);
  });
});
