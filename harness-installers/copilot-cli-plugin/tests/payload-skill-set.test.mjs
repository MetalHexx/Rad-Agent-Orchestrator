import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guard the rad-execute skill set against the tracked canonical source that the
// build ships into the payload (copy-skills draws output/skills/ from the
// adapter output, which the engine generates from harness-files/skills/).
//
// We assert against harness-files/skills/ rather than ../output/skills/ because
// output/ is a gitignored build artifact: it is absent on a fresh checkout (so
// the suite would fail under CI). The copy mechanics that carry the source into
// the payload are covered by build-payload.test.mjs.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SKILLS_SRC = path.join(REPO_ROOT, 'harness-files/skills');

test('canonical skill source includes rad-execute (FR-19)', () => {
  assert.ok(fs.existsSync(path.join(SKILLS_SRC, 'rad-execute/SKILL.md')),
    'harness-files/skills/rad-execute/SKILL.md must be present (ships into the payload)');
});

test('canonical skill source excludes retired rad-execute-parallel skill (FR-19, AD-5)', () => {
  assert.ok(!fs.existsSync(path.join(SKILLS_SRC, 'rad-execute-parallel')),
    'harness-files/skills/rad-execute-parallel must not exist (retired)');
});
