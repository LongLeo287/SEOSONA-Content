import test from 'node:test';
import assert from 'node:assert/strict';
import { runVisualJob } from '../scripts/companion/facebook-runner.mjs';

const asset = (quality) => ({
  ok: true,
  assets: [{ asset_id: 'asset-1', kind: 'image', file_name: 'post.png', provider: 'flow', url: 'https://provider.example/post.png', quality }],
});

test('checks Flow readiness then retries a rejected image with a new client revision', async () => {
  const calls = [];
  const responses = [
    { ok: true, data: { flow: { ready: true } } },
    asset({ judged: true, pass: false, score: 4.5, verdict: 'poor', action: 'rewrite_prompt', critical: [] }),
    asset({ judged: true, pass: true, score: 8.5, verdict: 'good', action: 'accept', critical: [] }),
  ];
  const flow = { callTool: async (name, args) => { calls.push({ name, args }); return responses.shift(); } };

  const result = await runVisualJob({
    flow,
    visualJob: { clientRef: 'week-2026-33/post-01/r1', prompt: 'Editorial SEO desk, no text in image.', ratio: '1:1', qualityGate: true },
  });

  assert.equal(result.status, 'asset_ready');
  assert.equal(result.retryCount, 1);
  assert.deepEqual(calls.map((call) => call.name), ['get_provider_status', 'gen_image', 'gen_image']);
  assert.equal(calls[1].args.client_ref, 'week-2026-33/post-01/r1');
  assert.equal(calls[2].args.client_ref, 'week-2026-33/post-01/r2');
  assert.match(calls[2].args.prompt, /Correct the visual quality issue/i);
});

test('holds an unjudged image for review without re-spending quota', async () => {
  const calls = [];
  const flow = { callTool: async (name, args) => {
    calls.push({ name, args });
    return name === 'get_provider_status'
      ? { ok: true, data: { flow: { ready: true } } }
      : asset({ judged: false, pass: null, score: null, verdict: 'unjudged', action: 'review_manually', critical: [] });
  } };

  const result = await runVisualJob({
    flow,
    visualJob: { clientRef: 'week-2026-33/post-02/r1', prompt: 'SEO strategy notebook, no text in image.', ratio: '1:1', qualityGate: true },
  });

  assert.equal(result.status, 'asset_needs_review');
  assert.equal(result.retryCount, 0);
  assert.equal(calls.filter((call) => call.name === 'gen_image').length, 1);
});

test('does not submit an image request when Flow is not ready', async () => {
  const calls = [];
  const flow = { callTool: async (name, args) => {
    calls.push({ name, args });
    return { ok: true, data: { flow: { ready: false, reason: 'NOT_LOGGED_IN' } } };
  } };

  await assert.rejects(
    runVisualJob({ flow, visualJob: { clientRef: 'week-2026-33/post-03/r1', prompt: 'SEO board, no text.', ratio: '1:1', qualityGate: true } }),
    /not ready/i,
  );
  assert.deepEqual(calls.map((call) => call.name), ['get_provider_status']);
});
