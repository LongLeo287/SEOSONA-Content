const MAX_IMAGE_RETRIES = 2;

function revisionClientRef(clientRef, revision) {
  return String(clientRef).replace(/\/r\d+$/, '/r' + revision);
}

function isFlowReady(status) {
  const data = status && status.data;
  if (!data) return false;
  if (data.flow && typeof data.flow.ready === 'boolean') return data.flow.ready;
  if (typeof data.ready === 'boolean') return data.ready;
  return false;
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

export async function runVisualJob({ flow, visualJob }) {
  if (!flow || typeof flow.callTool !== 'function') throw new Error('Flow client must expose callTool(name, arguments).');
  if (!visualJob || !visualJob.clientRef || !visualJob.prompt || !visualJob.ratio) throw new Error('Visual job requires clientRef, prompt, and ratio.');

  const readiness = await flow.callTool('get_provider_status', { provider: 'flow' });
  if (!isFlowReady(readiness)) throw new Error('Flow is not ready. Open SEOSONA Flow and sign in to an image provider.');

  let prompt = visualJob.prompt;
  let retryCount = 0;
  while (true) {
    const clientRef = revisionClientRef(visualJob.clientRef, retryCount + 1);
    const result = await flow.callTool('gen_image', {
      prompt,
      ratio: visualJob.ratio,
      client_ref: clientRef,
      quality_gate: visualJob.qualityGate === false ? false : true,
    });
    const asset = result && Array.isArray(result.assets) ? result.assets[0] : null;
    if (!result || result.ok !== true || !asset) throw new Error((result && result.error_message) || 'Flow did not return an image asset.');
    const quality = asset.quality;
    if (quality && quality.judged === true && quality.pass === false && retryCount < MAX_IMAGE_RETRIES && ['rewrite_prompt', 'regen_image'].includes(quality.action)) {
      retryCount += 1;
      prompt = retryPrompt(prompt, quality);
      continue;
    }
    return { ...statusFromQuality(quality, retryCount), asset, quality, prompt, clientRef, brandKitRef: visualJob.brandKitRef || null };
  }
}

export { MAX_IMAGE_RETRIES };
