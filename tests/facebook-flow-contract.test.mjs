import assert from 'node:assert/strict';
import test from 'node:test';
import { FlowMcpClient } from '../scripts/companion/facebook-mcp-client.mjs';
import { FlowMcpError, preflightFlow } from '../scripts/companion/facebook-runner.mjs';

test('preflights the official Flow 1.1 contract and actual provider status shape', async () => {
  const calls = [];
  const flow = { callTool: async (name) => {
    calls.push(name);
    if (name === 'health') return { ok: true, tool: 'health', status: 'completed', data: { extension_connected: true, contract_version: '1.1.0', auth: 'token' } };
    if (name === 'list_capabilities') return { ok: true, tool: name, status: 'completed', data: { provider: 'flow', ratios: ['9:16', '1:1'], image_models: [] } };
    return { ok: true, tool: name, status: 'completed', data: { providers: [{ provider: 'flow', ready: true, reason: 'ok' }] } };
  } };

  const result = await preflightFlow({ flow, ratio: '1:1' });
  assert.equal(result.contractVersion, '1.1.0');
  assert.equal(result.auth, 'token');
  assert.equal(result.provider.ready, true);
  assert.deepEqual(calls, ['health', 'list_capabilities', 'get_provider_status']);
});

test('rejects a no-auth Flow bridge before capabilities or generation', async () => {
  const calls = [];
  const flow = { callTool: async (name) => {
    calls.push(name);
    return { ok: true, tool: 'health', status: 'completed', data: { extension_connected: true, contract_version: '1.1.0', auth: 'none' } };
  } };

  await assert.rejects(
    preflightFlow({ flow, ratio: '1:1' }),
    (error) => error instanceof FlowMcpError && error.code === 'FLOW_AUTH_REQUIRED' && error.retryable === false,
  );
  assert.deepEqual(calls, ['health']);
});

test('rejects an incompatible Flow contract before generation', async () => {
  const flow = { callTool: async () => ({ ok: true, data: { extension_connected: true, contract_version: '2.0.0' } }) };
  await assert.rejects(
    preflightFlow({ flow, ratio: '1:1' }),
    (error) => error instanceof FlowMcpError && error.code === 'INCOMPATIBLE_FLOW_CONTRACT',
  );
});

test('Flow MCP client exposes tools/resources and forwards progress callbacks', async () => {
  const progress = () => {};
  const calls = [];
  const wrapper = new FlowMcpClient({ command: 'node' });
  wrapper.client = {
    callTool: async (...args) => { calls.push(args); return { structuredContent: { ok: true, tool: 'health', status: 'completed' } }; },
    listTools: async () => ({ tools: [{ name: 'health' }] }),
    readResource: async ({ uri }) => ({ contents: [{ uri, text: '{"contractVersion":"1.1.0"}' }] }),
  };

  assert.equal((await wrapper.callTool('health', {}, { onprogress: progress })).ok, true);
  assert.deepEqual(await wrapper.listTools(), [{ name: 'health' }]);
  assert.equal((await wrapper.readResource('seosona://contract')).contractVersion, '1.1.0');
  assert.equal(calls[0][2].onprogress, progress);
});
