const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const Factory = require('../extension/lib/facebook-factory.js');

const BASE_CONTEXT = {
  brand: { id: 'seosona', name: 'SEOSONA', voice: ['practical', 'evidence-led'] },
  group: { id: 'seo-marketers-vn', language: 'vi', audience: 'SEO and marketing practitioners in Vietnam' },
  policy: { requiredEvidence: true, cadencePerWeek: 5 },
  evidence: [{ id: 'e1', claim: 'Google Search Central documentation was reviewed.', source: 'https://developers.google.com/search' }],
  brandKitSnapshot: {
    ref: 'seosona-brand://video/SEOSONA/brand-kit.v1.json',
    version: '1.0.0',
    sha256: '4a678f77b800dcbc5509ce15786d2a3cf426ce6297691f05ed7bd2bd90654f14',
    palette: { identityBlue: '#003CA6', heroBlueStart: '#182FB3', heroBlueEnd: '#1F31B7', identityGreen: '#00FF00' },
    typography: { family: 'Be Vietnam Pro' },
    visualModes: { lightEditorial: { default: true }, cobaltHero: { default: false } },
    components: ['cover_dark', 'explain_light', 'proof_cards'],
    allowedAssets: ['mascot.pose.thinking'],
    flowBoundary: { role: 'pixel_worker' },
    negativeRules: [
      'No generated Vietnamese copy.', 'No generated logos or wordmarks.', 'No generated statistics or citations.',
      'No Chí Quyết Academy or coral styling.', 'No neon or cyberpunk.', 'No Poppins, Inter, or unapproved fonts.',
    ],
  },
};

test('creates an immutable context snapshot with a stable revision', () => {
  const first = Factory.createContextSnapshot(BASE_CONTEXT);
  const second = Factory.createContextSnapshot(JSON.parse(JSON.stringify(BASE_CONTEXT)));

  assert.equal(first.contextRevision, second.contextRevision);
  assert.equal(first.group.id, 'seo-marketers-vn');
  assert.equal(first.brandKitSnapshot.version, '1.0.0');
  assert.equal(Object.isFrozen(first), true);
});

test('creates exactly five draft jobs for a weekly Facebook batch', () => {
  const snapshot = Factory.createContextSnapshot(BASE_CONTEXT);
  const batch = Factory.createWeeklyBatch({ id: 'week-2026-33', snapshot, topics: ['SEO audit', 'Content brief', 'Internal link', 'Schema', 'E-E-A-T'] });

  assert.equal(batch.drafts.length, 5);
  assert.deepEqual(batch.drafts.map((draft) => draft.clientRef), [
    'week-2026-33/post-01/r1',
    'week-2026-33/post-02/r1',
    'week-2026-33/post-03/r1',
    'week-2026-33/post-04/r1',
    'week-2026-33/post-05/r1',
  ]);
});

test('blocks a draft that makes a claim without an evidence reference', () => {
  const result = Factory.validateDraftPackage({
    id: 'draft-1',
    copy: 'Google guarantees rankings in seven days.',
    claims: [{ text: 'Google guarantees rankings in seven days.', evidenceId: null }],
    creativeBrief: { visualPrompt: 'Editorial SEO desk, no text in image.', ratio: '1:1' },
  }, BASE_CONTEXT.evidence);

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [{ code: 'MISSING_EVIDENCE', claimIndex: 0 }]);
});

test('allows an evidence-backed draft and returns a normalized visual job', () => {
  const result = Factory.validateDraftPackage({
    id: 'draft-2',
    copy: 'Use Google Search Central documentation as a starting point for technical SEO decisions.',
    claims: [{ text: 'Google Search Central documentation was reviewed.', evidenceId: 'e1' }],
    creativeBrief: { visualPrompt: 'Vietnamese SEO practitioner reviewing a crawl report, clean editorial lighting, no text in image.', ratio: '1:1' },
  }, BASE_CONTEXT.evidence, { clientRef: 'week-2026-33/post-02/r1' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.visualJob, {
    clientRef: 'week-2026-33/post-02/r1',
    prompt: 'Vietnamese SEO practitioner reviewing a crawl report, clean editorial lighting, no text in image.',
    ratio: '1:1',
    qualityGate: true,
  });
});

test('merges the verified BrandKit snapshot into VisualJob and the Flow-safe prompt', () => {
  const result = Factory.validateDraftPackage({
    id: 'draft-brand', copy: 'A useful, evidence-backed SEO discussion.',
    claims: [{ text: 'Google Search Central documentation was reviewed.', evidenceId: 'e1' }],
    creativeBrief: { visualPrompt: 'SEO analyst reviewing a crawl report.', ratio: '1:1', mode: 'lightEditorial', component: 'proof_cards' },
  }, BASE_CONTEXT.evidence, { clientRef: 'week-2026-33/post-03/r1', brandKitSnapshot: BASE_CONTEXT.brandKitSnapshot });

  assert.deepEqual(result.visualJob.brandKitRef, {
    ref: BASE_CONTEXT.brandKitSnapshot.ref,
    version: '1.0.0',
    sha256: BASE_CONTEXT.brandKitSnapshot.sha256,
  });
  assert.equal(result.visualJob.mode, 'lightEditorial');
  assert.equal(result.visualJob.component, 'proof_cards');
  assert.deepEqual(result.visualJob.allowedAssets, []);
  assert.deepEqual(result.visualJob.negativeRules, BASE_CONTEXT.brandKitSnapshot.negativeRules);
  assert.match(result.visualJob.prompt, /BrandKit v1\.0\.0/i);
  assert.match(result.visualJob.prompt, /#003CA6.*#182FB3.*#1F31B7.*#00FF00/i);
  assert.match(result.visualJob.prompt, /Be Vietnam Pro.*compositor/i);
  assert.match(result.visualJob.prompt, /text-free.*Vietnamese.*logos.*statistics.*citations/is);
  assert.match(result.visualJob.prompt, /Academy.*coral.*neon.*cyberpunk.*Poppins.*Inter/is);
});

test('retries a judged failed image at most twice and holds unjudged output for review', () => {
  assert.deepEqual(Factory.nextAssetAction({ judged: true, pass: false, action: 'rewrite_prompt' }, 0), { type: 'retry', retryCount: 1 });
  assert.deepEqual(Factory.nextAssetAction({ judged: true, pass: false, action: 'regen_image' }, 1), { type: 'retry', retryCount: 2 });
  assert.deepEqual(Factory.nextAssetAction({ judged: true, pass: false, action: 'regen_image' }, 2), { type: 'asset_needs_review', retryCount: 2 });
  assert.deepEqual(Factory.nextAssetAction({ judged: false, pass: null, action: 'review_manually' }, 0), { type: 'asset_needs_review', retryCount: 0 });
});

test('normalizes an asset receipt without retaining image binary data', () => {
  const receipt = Factory.createAssetReceipt({
    batchId: 'week-2026-33',
    draftId: 'post-01',
    asset: { asset_id: 'asset-1', kind: 'image', file_name: 'post-01.png', provider: 'flow', url: 'https://provider.example/asset-1' },
    quality: { judged: true, pass: true, score: 8.5, verdict: 'good', action: 'accept', critical: [] },
    retryCount: 0,
    promptRevision: 1,
    brandKitRef: {
      ref: BASE_CONTEXT.brandKitSnapshot.ref,
      version: BASE_CONTEXT.brandKitSnapshot.version,
      sha256: BASE_CONTEXT.brandKitSnapshot.sha256,
    },
  });

  assert.deepEqual(receipt, {
    id: 'week-2026-33/post-01/asset-1',
    assetId: 'asset-1',
    kind: 'image',
    fileName: 'post-01.png',
    provider: 'flow',
    sourceUrl: 'https://provider.example/asset-1',
    quality: { judged: true, pass: true, score: 8.5, verdict: 'good', action: 'accept', critical: [] },
    retryCount: 0,
    promptRevision: 1,
    brandKitRef: {
      ref: BASE_CONTEXT.brandKitSnapshot.ref,
      version: BASE_CONTEXT.brandKitSnapshot.version,
      sha256: BASE_CONTEXT.brandKitSnapshot.sha256,
    },
  });
});

test('sidepanel passes the verified BrandKit snapshot into every visual gate', () => {
  const app = readFileSync(join(__dirname, '../extension/sidepanel/app.js'), 'utf8');
  assert.match(app, /brandKitSnapshot:\s*snapshot\.brandKitSnapshot/);
});
