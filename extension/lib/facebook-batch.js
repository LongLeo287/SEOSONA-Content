/* SEOSONA Facebook Group Batch — provider prompt and strict draft parser. */
(function (root, factory) {
  const api = factory(root.FacebookFactory);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FacebookBatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Factory) {
  'use strict';
  if (!Factory) throw new Error('FacebookFactory must load before FacebookBatch.');

  function stripFence(text) {
    const match = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
    return (match ? match[1] : text).trim();
  }

  function parseDraftResponse(text) {
    let draft;
    try { draft = JSON.parse(stripFence(text)); } catch { throw new Error('Provider response must contain valid JSON for a Facebook draft package.'); }
    if (!draft || typeof draft !== 'object' || !draft.idea || !draft.copy || !draft.cta || !Array.isArray(draft.claims) || !draft.creativeBrief) {
      throw new Error('Provider JSON is missing required DraftPackage fields.');
    }
    return {
      idea: String(draft.idea), copy: String(draft.copy), cta: String(draft.cta),
      claims: draft.claims.map((claim) => ({ text: String(claim && claim.text || ''), evidenceId: claim && claim.evidenceId || null })),
      creativeBrief: { visualPrompt: String(draft.creativeBrief.visualPrompt || ''), ratio: String(draft.creativeBrief.ratio || '') },
    };
  }

  function buildDraftPrompt({ topic, snapshot }) {
    if (!snapshot || !snapshot.brand || !snapshot.group || !snapshot.policy) throw new Error('An OS context snapshot is required.');
    const evidence = (snapshot.evidence || []).map((item) => ({ id: item.id, claim: item.claim, source: item.source })).filter((item) => item.id);
    return [
      'You are SEOSONA Content. Produce one Facebook Group draft package for Vietnamese SEO and marketing practitioners.',
      `Brand: ${snapshot.brand.name}. Voice: ${(snapshot.brand.voice || []).join(', ')}.`,
      `Group audience: ${snapshot.group.audience}. Language: Vietnamese. Topic: ${String(topic)}.`,
      'Use only the evidence IDs below for factual claims. If evidence is insufficient, write an educational opinion without unsupported factual claims.',
      'Return ONLY valid JSON, with no prose and no markdown fence.',
      'Required JSON schema: {"idea":"...","copy":"Vietnamese post body","cta":"...","claims":[{"text":"claim","evidenceId":"evidence-id"}],"creativeBrief":{"visualPrompt":"English image prompt, editorial, no text in image","ratio":"1:1"}}.',
      `Evidence packet: ${JSON.stringify(evidence)}`,
    ].join('\n\n');
  }

  return { buildDraftPrompt, parseDraftResponse };
});
