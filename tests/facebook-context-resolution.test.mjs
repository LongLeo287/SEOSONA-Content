import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOsContext } from '../scripts/companion/facebook-companion.mjs';

test('resolves an OS context manifest from its four versioned sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'seosona-os-context-'));
  await Promise.all([
    writeFile(join(root, 'brand.json'), JSON.stringify({ brand: { id: 'seosona' } })),
    writeFile(join(root, 'group.json'), JSON.stringify({ group: { id: 'seo-vn' } })),
    writeFile(join(root, 'policy.json'), JSON.stringify({ policy: { requiredEvidence: true } })),
    writeFile(join(root, 'evidence.json'), JSON.stringify({ evidence: [{ id: 'e1' }] })),
    writeFile(join(root, 'context.json'), JSON.stringify({ sources: { brand: 'brand.json', group: 'group.json', policy: 'policy.json', evidence: 'evidence.json' } })),
  ]);
  assert.deepEqual(await loadOsContext(join(root, 'context.json')), {
    contractVersion: '1.0', brand: { id: 'seosona' }, group: { id: 'seo-vn' }, policy: { requiredEvidence: true }, evidence: [{ id: 'e1' }],
  });
});

const BRAND_KIT_REF = 'seosona-brand://video/SEOSONA/brand-kit.v1.json';

function brandKitFixture(overrides = {}) {
  return {
    version: '1.0.0',
    palette: {
      identityBlue: '#003CA6', heroBlueStart: '#182FB3', heroBlueEnd: '#1F31B7', identityGreen: '#00FF00',
      canvasWhite: '#FFFFFF', canvasMist: '#F6F8FD', inkPrimary: '#111B3F', inkSecondary: '#667085', lineSubtle: '#E2E8F0',
    },
    typography: { family: 'Be Vietnam Pro' },
    visualModes: { lightEditorial: { default: true }, cobaltHero: { default: false } },
    components: ['cover_dark', 'explain_light', 'proof_cards'],
    mascot: { allowedPoseAssets: ['mascot.pose.thinking'] },
    flowBoundary: { role: 'pixel_worker', generate: ['text-free scene imagery'], deterministicCompositorOwns: ['Vietnamese copy', 'logo', 'statistics', 'citations', 'UI labels'] },
    negativeRules: ['No generated copy.', 'No generated logos.', 'No statistics or citations.', 'No Academy coral styling.', 'No neon or cyberpunk.', 'No unapproved fonts.'],
    ...overrides,
  };
}

async function createBrandContext({ kit = brandKitFixture(), referenceOverrides = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'seosona-os-brand-context-'));
  const brandKitFile = join(root, 'brand-kit.v1.json');
  const brandKitText = `${JSON.stringify(kit, null, 2)}\n`;
  const sha256 = createHash('sha256').update(brandKitText).digest('hex');
  const brandKit = { ref: BRAND_KIT_REF, version: '1.0.0', sha256, ...referenceOverrides };
  await Promise.all([
    writeFile(brandKitFile, brandKitText),
    writeFile(join(root, 'brand.json'), JSON.stringify({ brand: { id: 'seosona', name: 'SEOSONA', visual: { brandKit } } })),
    writeFile(join(root, 'group.json'), JSON.stringify({ group: { id: 'seo-vn' } })),
    writeFile(join(root, 'policy.json'), JSON.stringify({ policy: { requiredEvidence: true } })),
    writeFile(join(root, 'evidence.json'), JSON.stringify({ evidence: [] })),
    writeFile(join(root, 'context.json'), JSON.stringify({ sources: { brand: 'brand.json', group: 'group.json', policy: 'policy.json', evidence: 'evidence.json' } })),
  ]);
  return { contextFile: join(root, 'context.json'), brandKitFile, sha256 };
}

test('verifies and freezes the external BrandKit subset into resolved context', async () => {
  const fixture = await createBrandContext();
  const context = await loadOsContext(fixture.contextFile, { brandKitFile: fixture.brandKitFile });

  assert.deepEqual(context.brandKitSnapshot, {
    ref: BRAND_KIT_REF,
    version: '1.0.0',
    sha256: fixture.sha256,
    palette: brandKitFixture().palette,
    typography: { family: 'Be Vietnam Pro' },
    visualModes: brandKitFixture().visualModes,
    components: brandKitFixture().components,
    allowedAssets: ['mascot.pose.thinking'],
    flowBoundary: brandKitFixture().flowBoundary,
    negativeRules: brandKitFixture().negativeRules,
  });
});

test('requires a physical BrandKit file when OS declares a reference', async () => {
  const fixture = await createBrandContext();
  await assert.rejects(loadOsContext(fixture.contextFile), /SEOSONA_BRAND_KIT_FILE/i);
});

test('rejects BrandKit digest and version drift', async () => {
  const digestDrift = await createBrandContext({ referenceOverrides: { sha256: '0'.repeat(64) } });
  await assert.rejects(
    loadOsContext(digestDrift.contextFile, { brandKitFile: digestDrift.brandKitFile }),
    /digest mismatch/i,
  );

  const versionDrift = await createBrandContext({ kit: brandKitFixture({ version: '1.1.0' }) });
  await assert.rejects(
    loadOsContext(versionDrift.contextFile, { brandKitFile: versionDrift.brandKitFile }),
    /version mismatch/i,
  );
});

test('rejects a machine path embedded as the OS BrandKit reference', async () => {
  const fixture = await createBrandContext({ referenceOverrides: { ref: `${String.fromCharCode(90, 58, 92)}brand\\brand-kit.v1.json` } });
  await assert.rejects(
    loadOsContext(fixture.contextFile, { brandKitFile: fixture.brandKitFile }),
    /logical seosona-brand URI/i,
  );
});
