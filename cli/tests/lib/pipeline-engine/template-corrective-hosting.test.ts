import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTemplate } from '../../../src/lib/pipeline-engine/template-loader.js';
import type { StepNodeDef } from '../../../src/lib/pipeline-engine/types.js';

const TIER_TEMPLATES = ['low', 'medium', 'high', 'extra-high'];

describe('final_review hosts_correctives declaration (P01-T01)', () => {
  it.each(TIER_TEMPLATES)('%s.yml loads and its final_review node def carries hosts_correctives === true', (tier) => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const templatePath = path.join(repoRoot, 'runtime-config', 'templates', `${tier}.yml`);

    const { template } = loadTemplate(templatePath);
    const finalReview = template.nodes.find((n) => n.id === 'final_review') as StepNodeDef | undefined;

    expect(finalReview).toBeDefined();
    expect(finalReview?.hosts_correctives).toBe(true);
  });
});
