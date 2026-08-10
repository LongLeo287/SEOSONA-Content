import test from 'node:test';
import assert from 'node:assert/strict';
import { FlowMcpError, runVisualJob } from '../scripts/companion/facebook-runner.mjs';

const asset = (quality) => ({
  ok: true,
  assets: [{ asset_id: 'asset-1', kind: 'image', file_name: 'post.png', provider: 'flow', url: 'https://provider.example/post.png', quality }],
});

test('checks Flow readiness then retries a rejected image with a new client revision', async () => {
  const calls = [];
  const responses = [
    { ok: true, data: { extension_connected: true, contract_version: '1.1.0' } },
    { ok: true, data: { provider: 'flow', ratios: ['1:1', '9:16'], image_models: [] } },
    { ok: true, data: { providers: [{ provider: 'flow', ready: true, reason: 'ok' }] } },
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
  assert.deepEqual(calls.map((call) => call.name), ['health', 'list_capabilities', 'get_provider_status', 'gen_image', 'gen_image']);
  assert.equal(calls[3].args.client_ref, 'week-2026-33/post-01/r1');
  assert.equal(calls[4].args.client_ref, 'week-2026-33/post-01/r2');
  assert.match(calls[4].args.prompt, /Correct the visual quality issue/i);
});

test('holds an unjudged image for review without re-spending quota', async () => {
  const calls = [];
  const flow = { callTool: async (name, args) => {
    calls.push({ name, args });
    if (name === 'health') return { ok: true, data: { extension_connected: true, contract_version: '1.1.0' } };
    if (name === 'list_capabilities') return { ok: true, data: { provider: 'flow', ratios: ['1:1'] } };
    if (name === 'get_provider_status') return { ok: true, data: { providers: [{ provider: 'flow', ready: true, reason: 'ok' }] } };
    return asset({ judged: false, pass: null, score: null, verdict: 'unjudged', action: 'review_manually', critical: [] });
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
    if (name === 'health') return { ok: true, data: { extension_connected: true, contract_version: '1.1.0' } };
    if (name === 'list_capabilities') return { ok: true, data: { provider: 'flow', ratios: ['1:1'] } };
    return { ok: true, data: { providers: [{ provider: 'flow', ready: false, reason: 'tab_or_project_not_ready' }] } };
  } };

  await assert.rejects(
    runVisualJob({ flow, visualJob: { clientRef: 'week-2026-33/post-03/r1', prompt: 'SEO board, no text.', ratio: '1:1', qualityGate: true } }),
    (error) => error instanceof FlowMcpError && error.code === 'PROVIDER_TAB_NOT_READY',
  );
  assert.deepEqual(calls.map((call) => call.name), ['health', 'list_capabilities', 'get_provider_status']);
});

test('retries EXTENSION_BUSY without changing client_ref', async () => {
  const refs = [];
  let generationCalls = 0;
  const flow = { callTool: async (name, args) => {
    if (name === 'health') return { ok: true, data: { extension_connected: true, contract_version: '1.1.0' } };
    if (name === 'list_capabilities') return { ok: true, data: { provider: 'flow', ratios: ['1:1'] } };
    if (name === 'get_provider_status') return { ok: true, data: { providers: [{ provider: 'flow', ready: true, reason: 'ok' }] } };
    refs.push(args.client_ref); generationCalls += 1;
    return generationCalls === 1
      ? { ok: false, status: 'failed', error_code: 'EXTENSION_BUSY', error_message: 'busy' }
      : asset({ judged: true, pass: true, score: 8, verdict: 'good', action: 'accept', critical: [] });
  } };

  const result = await runVisualJob({
    flow,
    wait: async () => {},
    visualJob: { clientRef: 'week/post/r1', prompt: 'SEO desk.', ratio: '1:1' },
  });

  assert.equal(result.status, 'asset_ready');
  assert.deepEqual(refs, ['week/post/r1', 'week/post/r1']);
});

test('does not retry quota errors', async () => {
  let generationCalls = 0;
  const flow = { callTool: async (name) => {
    if (name === 'health') return { ok: true, data: { extension_connected: true, contract_version: '1.1.0' } };
    if (name === 'list_capabilities') return { ok: true, data: { provider: 'flow', ratios: ['1:1'] } };
    if (name === 'get_provider_status') return { ok: true, data: { providers: [{ provider: 'flow', ready: true, reason: 'ok' }] } };
    generationCalls += 1;
    return { ok: false, status: 'failed', error_code: 'DAILY_QUOTA_EXCEEDED', error_message: 'quota spent' };
  } };

  await assert.rejects(
    runVisualJob({ flow, wait: async () => {}, visualJob: { clientRef: 'week/post/r1', prompt: 'SEO desk.', ratio: '1:1' } }),
    (error) => error instanceof FlowMcpError && error.code === 'DAILY_QUOTA_EXCEEDED' && error.retryable === false,
  );
  assert.equal(generationCalls, 1);
});
