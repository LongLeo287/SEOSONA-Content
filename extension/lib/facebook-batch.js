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
      creativeBrief: {
        visualPrompt: String(draft.creativeBrief.visualPrompt || ''),
        ratio: String(draft.creativeBrief.ratio || ''),
        mode: String(draft.creativeBrief.mode || 'lightEditorial'),
        component: String(draft.creativeBrief.component || 'explain_light'),
      },
    };
  }

  function buildIdeaPrompt({ count, snapshot }) {
    if (!snapshot || !snapshot.brand || !snapshot.group || !snapshot.policy) throw new Error('An OS context snapshot is required.');
    if (!Number.isInteger(count) || count < 1) throw new Error('Idea count must be a positive integer.');
    const evidence = (snapshot.evidence || []).map((item) => ({ id: item.id, claim: item.claim })).filter((item) => item.id);
    return [
      'You are SEOSONA Content. Generate exactly ' + count + ' distinct Facebook Group content ideas for Vietnamese SEO and marketing practitioners.',
      'Brand voice: ' + (snapshot.brand.voice || []).join(', ') + '. Group objective: ' + String(snapshot.group.objective || snapshot.group.audience || '') + '.',
      evidence.length
        ? 'Use these verified evidence themes when useful: ' + JSON.stringify(evidence) + '.'
        : 'The evidence packet is empty. Use educational experience/opinion angles only and do not propose unsupported factual claims.',
      'Return ONLY valid JSON: {"ideas":[{"title":"Vietnamese topic","angle":"Vietnamese non-duplicate angle"}]}.',
      'The ideas array must contain exactly ' + count + ' items. Titles must be unique.',
    ].join('\n\n');
  }

  function parseIdeaResponse(text, expectedCount) {
    let response;
    try { response = JSON.parse(stripFence(text)); } catch { throw new Error('Provider response must contain valid JSON for Facebook ideas.'); }
    const ideas = response && response.ideas;
    if (!Array.isArray(ideas) || ideas.length !== expectedCount) throw new Error('Provider must return exactly ' + expectedCount + ' ideas.');
    const normalized = ideas.map((idea) => ({ title: String(idea && idea.title || '').trim(), angle: String(idea && idea.angle || '').trim() }));
    if (normalized.some((idea) => !idea.title || !idea.angle)) throw new Error('Every idea requires a title and angle.');
    const titles = normalized.map((idea) => idea.title.toLocaleLowerCase('vi'));
    if (new Set(titles).size !== normalized.length) throw new Error('Provider ideas must be distinct.');
    return normalized;
  }

  function buildDraftPrompt({ topic, snapshot }) {
    if (!snapshot || !snapshot.brand || !snapshot.group || !snapshot.policy) throw new Error('An OS context snapshot is required.');
    const evidence = (snapshot.evidence || []).map((item) => ({ id: item.id, claim: item.claim, source: item.source })).filter((item) => item.id);
    return [
      'You are SEOSONA Content. Produce one Facebook Group draft package for Vietnamese SEO and marketing practitioners.',
      `Brand: ${snapshot.brand.name}. Voice: ${(snapshot.brand.voice || []).join(', ')}.`,
      `Group audience: ${snapshot.group.audience}. Language: Vietnamese. Topic: ${String(topic)}.`,
      'Use only the evidence IDs below for factual claims. In claims[].text, copy the exact supported claim from the evidence packet, and include that exact claim verbatim as its own sentence in copy; never paraphrase or reverse its meaning. If evidence is insufficient, write an explicitly framed educational opinion without unsupported factual claims.',
      'Return ONLY valid JSON, with no prose and no markdown fence.',
      'Required JSON schema: {"idea":"...","copy":"Vietnamese post body","cta":"...","claims":[{"text":"claim","evidenceId":"evidence-id"}],"creativeBrief":{"visualPrompt":"English image prompt, editorial, no text in image","ratio":"1:1","mode":"lightEditorial","component":"explain_light"}}.',
      `Evidence packet: ${JSON.stringify(evidence)}`,
    ].join('\n\n');
  }

  return { buildIdeaPrompt, parseIdeaResponse, buildDraftPrompt, parseDraftResponse };
});
