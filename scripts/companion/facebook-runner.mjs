const MAX_IMAGE_RETRIES = 2;
const MAX_BUSY_RETRIES = 2;
const SUPPORTED_FLOW_CONTRACT = /^1\.1\./;

export class FlowMcpError extends Error {
  constructor(code, message, { retryable = false, details = null } = {}) {
    super(message || code || 'Flow MCP error.');
    this.name = 'FlowMcpError';
    this.code = code || 'GEN_FAILED';
    this.retryable = retryable;
    this.details = details;
  }
}

function requireOk(result, fallbackCode, fallbackMessage) {
  if (result && result.ok === true) return result;
  const code = result && result.error_code || fallbackCode || 'GEN_FAILED';
  throw new FlowMcpError(code, result && result.error_message || fallbackMessage || 'Flow MCP call failed.', {
    retryable: code === 'EXTENSION_BUSY', details: result || null,
  });
}

function revisionClientRef(clientRef, revision) {
  return String(clientRef).replace(/\/r\d+$/, '/r' + revision);
}

function isFlowReady(status) {
  const data = status && status.data;
  if (!data) return false;
  if (Array.isArray(data.providers)) {
    const provider = data.providers.find((item) => item && item.provider === 'flow');
    return !!(provider && provider.ready === true);
  }
  if (data.flow && typeof data.flow.ready === 'boolean') return data.flow.ready;
  if (typeof data.ready === 'boolean') return data.ready;
  return false;
}

function providerFromStatus(status) {
  const data = status && status.data || {};
  if (Array.isArray(data.providers)) return data.providers.find((item) => item && item.provider === 'flow') || null;
  if (data.flow) return { provider: 'flow', ready: data.flow.ready === true, reason: data.flow.reason || 'not_ready' };
  return { provider: 'flow', ready: data.ready === true, reason: data.reason || 'not_ready' };
}

export async function preflightFlow({ flow, ratio }) {
  if (!flow || typeof flow.callTool !== 'function') throw new Error('Flow client must expose callTool(name, arguments).');
  const health = requireOk(await flow.callTool('health', {}), 'FLOW_UNAVAILABLE', 'Flow health check failed.');
  const contractVersion = String(health.data && health.data.contract_version || '');
  if (!SUPPORTED_FLOW_CONTRACT.test(contractVersion)) {
    throw new FlowMcpError('INCOMPATIBLE_FLOW_CONTRACT', 'Content requires Flow contract 1.1.x; received ' + (contractVersion || 'none') + '.');
  }
  if (health.data.extension_connected !== true) {
    throw new FlowMcpError('FLOW_EXTENSION_DISCONNECTED', 'SEOSONA Flow extension is not connected.');
  }
  const capabilities = requireOk(await flow.callTool('list_capabilities', { provider: 'flow' }), 'CAPABILITIES_UNAVAILABLE', 'Flow capabilities are unavailable.');
  const ratios = capabilities.data && capabilities.data.ratios;
  if (ratio && Array.isArray(ratios) && !ratios.includes(ratio)) {
    throw new FlowMcpError('VALIDATION_ERROR', 'Flow does not support ratio ' + ratio + '.');
  }
  const status = requireOk(await flow.callTool('get_provider_status', { provider: 'flow' }), 'PROVIDER_STATUS_UNAVAILABLE', 'Flow provider status is unavailable.');
  const provider = providerFromStatus(status);
  if (!isFlowReady(status)) {
    const reason = String(provider && provider.reason || 'not_ready');
    const code = /login|logged/i.test(reason) ? 'PROVIDER_NOT_LOGGED_IN' : 'PROVIDER_TAB_NOT_READY';
    throw new FlowMcpError(code, 'Flow provider is not ready: ' + reason + '.', { details: provider });
  }
  return { contractVersion, capabilities: capabilities.data || {}, provider };
}

function retryPrompt(prompt, quality) {
  const critical = Array.isArray(quality && quality.critical) && quality.critical.length
    ? quality.critical.join('; ')
    : quality && quality.verdict || 'visual quality issue';
  return String(prompt).trim() + ' Correct the visual quality issue: ' + critical + '. Keep the original subject, ratio, and no-text requirement.';
}

function statusFromQuality(quality, retryCount) {
  if (!quality || quality.judged !== true || quality.pass !== true) return { status: 'asset_needs_review', retryCount };
  return { status: 'asset_ready', retryCount };
}

async function generateWithBusyRetry({ flow, args, wait }) {
  for (let attempt = 0; attempt <= MAX_BUSY_RETRIES; attempt += 1) {
    const result = await flow.callTool('gen_image', args);
    if (result && result.ok === true) return result;
    const code = result && result.error_code || 'GEN_FAILED';
    if (code !== 'EXTENSION_BUSY' || attempt === MAX_BUSY_RETRIES) {
      return requireOk(result, code, 'Flow did not return an image asset.');
    }
    await wait(250 * (attempt + 1));
  }
  throw new FlowMcpError('EXTENSION_BUSY', 'Flow remained busy.', { retryable: true });
}

export async function runVisualJob({ flow, visualJob, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!flow || typeof flow.callTool !== 'function') throw new Error('Flow client must expose callTool(name, arguments).');
  if (!visualJob || !visualJob.clientRef || !visualJob.prompt || !visualJob.ratio) throw new Error('Visual job requires clientRef, prompt, and ratio.');

  const preflight = await preflightFlow({ flow, ratio: visualJob.ratio });

  let prompt = visualJob.prompt;
  let retryCount = 0;
  while (true) {
    const clientRef = revisionClientRef(visualJob.clientRef, retryCount + 1);
    const result = await generateWithBusyRetry({ flow, wait, args: {
      prompt,
      ratio: visualJob.ratio,
      client_ref: clientRef,
      quality_gate: visualJob.qualityGate === false ? false : true,
    } });
    const asset = result && Array.isArray(result.assets) ? result.assets[0] : null;
    if (!asset) throw new FlowMcpError('ASSET_MISSING', 'Flow did not return an image asset.');
    const quality = asset.quality;
    if (quality && quality.judged === true && quality.pass === false && retryCount < MAX_IMAGE_RETRIES && ['rewrite_prompt', 'regen_image'].includes(quality.action)) {
      retryCount += 1;
      prompt = retryPrompt(prompt, quality);
      continue;
    }
    return {
      ...statusFromQuality(quality, retryCount), asset, quality, prompt, clientRef,
      brandKitRef: visualJob.brandKitRef || null, flowContractVersion: preflight.contractVersion,
    };
  }
}

export { MAX_IMAGE_RETRIES };
