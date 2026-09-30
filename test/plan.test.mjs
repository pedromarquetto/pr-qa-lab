import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../src/plan.mjs';
import { safeUrl } from '../src/browser.mjs';

test('accepts the reviewed demo plan', async () => {
  const { readFile } = await import('node:fs/promises');
  const plan = JSON.parse(await readFile(new URL('../examples/demo-plan.json', import.meta.url)));
  assert.equal(validatePlan(plan).tests.length, 1);
});
test('rejects an executable action from model output', () => {
  assert.throws(() => validatePlan({ tests: [{ name: 'bad', steps: [{ action: 'eval', target: 'css:body', value: '' }] }] }));
});
test('navigation stays on preview origin', () => {
  assert.equal(safeUrl('https://preview.example/', '/checkout'), 'https://preview.example/checkout');
  assert.throws(() => safeUrl('https://preview.example/', 'http://127.0.0.1/admin'));
});
