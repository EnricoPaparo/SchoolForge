import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('visual generation terminal telemetry', () => {
  it.each([
    ['aiVisualPlanGateway.ts', 'authorize_plan', 'visual_plan_proposal'],
    ['aiVisualPlanExecutionGateway.ts', 'generate_slot', 'visual_image'],
    ['aiVisualPlanExecutionGateway.ts', 'promote_slot', 'visual_image'],
  ])('usa eventi aggregabili e privi di contenuti in %s', (fileName, stage, kind) => {
    const source = readFileSync(new URL(`./${fileName}`, import.meta.url), 'utf8');
    const events = [
      ...source.matchAll(/logger\.(?:info|error)\('aiVisualPlanGateway', \{([\s\S]*?)\n\s*\}\);/g),
    ];
    expect(events.length).toBeGreaterThanOrEqual(3);
    const relevant = events.filter((event) => event[1]?.includes(`stage: '${stage}'`));
    expect(relevant).toHaveLength(3);
    for (const event of relevant) {
      const fields = event[1] ?? '';
      expect(fields).toContain(`kind: '${kind}'`);
      expect(fields).toContain('outcome:');
      expect(fields).toContain('durationMs:');
      expect(fields).not.toMatch(
        /(?:uid|requestId|prompt|guidance|title|content|body|subject|caption|token|cost|message|name)\s*:/i,
      );
    }
  });
});
