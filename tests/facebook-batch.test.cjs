const test = require('node:test');
const assert = require('node:assert/strict');

global.FacebookFactory = require('../extension/lib/facebook-factory.js');
const Batch = require('../extension/lib/facebook-batch.js');

const context = {
  brand: { id: 'seosona', name: 'SEOSONA', voice: ['evidence-led'] },
  group: { id: 'seo-vn', language: 'vi', audience: 'Vietnamese SEO practitioners' },
  policy: { requiredEvidence: true, cadencePerWeek: 5, batchSize: { default: 5, min: 1, max: 20 } },
  evidence: [{ id: 'evidence-1', claim: 'Search Central is an official Google documentation source.', source: 'https://developers.google.com/search' }],
};

test('builds a weekly batch prompt that requires JSON, Vietnamese copy, and evidence ids', () => {
  const snapshot = global.FacebookFactory.createContextSnapshot(context);
  const prompt = Batch.buildDraftPrompt({ topic: 'Technical SEO audit', snapshot });
  assert.match(prompt, /Vietnamese/i);
  assert.match(prompt, /evidence-1/);
  assert.match(prompt, /creativeBrief/);
  assert.match(prompt, /JSON/i);
});

test('builds and parses exactly the requested number of distinct ideas', () => {
  const snapshot = global.FacebookFactory.createContextSnapshot(context);
  const prompt = Batch.buildIdeaPrompt({ count: 2, snapshot });
  assert.match(prompt, /exactly 2/i);
  assert.match(prompt, /Vietnamese/i);

  const ideas = Batch.parseIdeaResponse(JSON.stringify({ ideas: [
    { title: 'Audit SEO từ bằng chứng', angle: 'Bắt đầu từ dữ liệu có thể kiểm tra' },
    { title: 'Internal link có chủ đích', angle: 'Ưu tiên hành trình người đọc' },
  ] }), 2);
  assert.equal(ideas.length, 2);
  assert.equal(ideas[0].title, 'Audit SEO từ bằng chứng');
  assert.throws(() => Batch.parseIdeaResponse(JSON.stringify({ ideas: [ideas[0], ideas[0]] }), 2), /distinct/i);
  assert.throws(() => Batch.parseIdeaResponse(JSON.stringify({ ideas: [ideas[0]] }), 2), /exactly 2/i);
});

test('parses the provider JSON into a draft package and rejects non-JSON output', () => {
  const parsed = Batch.parseDraftResponse('```json\n{"idea":"Audit theo bằng chứng","copy":"Hãy bắt đầu từ tài liệu chính thức.","cta":"Bạn đang kiểm tra nguồn nào?","claims":[{"text":"Search Central is an official Google documentation source.","evidenceId":"evidence-1"}],"creativeBrief":{"visualPrompt":"Vietnamese SEO professional reviewing a crawl report, no text in image.","ratio":"1:1"}}\n```');
  assert.equal(parsed.cta, 'Bạn đang kiểm tra nguồn nào?');
  assert.equal(parsed.claims[0].evidenceId, 'evidence-1');
  assert.throws(() => Batch.parseDraftResponse('a normal prose answer'), /valid JSON/i);
});
