import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package scripts keep legacy verification and expose generic test/runtime commands', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.cjs tests/*.test.mjs');
  assert.equal(pkg.scripts['runtime:start'], 'node runtime/index.mjs');
  assert.ok(pkg.scripts['facebook:verify']);
});
