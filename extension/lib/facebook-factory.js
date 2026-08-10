/* SEOSONA Facebook Group Factory — browser-safe contracts and policy helpers. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FacebookFactory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((out, key) => {
        out[key] = canonicalize(value[key]);
        return out;
      }, {});
    }
    return value;
  }

  function stableStringify(value) { return JSON.stringify(canonicalize(value)); }

  function hash(value) {
    let h = 0x811c9dc5;
    const text = stableStringify(value);
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => freeze(value[key]));
    return value;
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function createContextSnapshot(context) {
    assert(context && context.brand && context.group && context.policy, 'Context requires brand, group, and policy.');
    const snapshot = {
      contractVersion: '1.0',
      brand: canonicalize(context.brand),
      group: canonicalize(context.group),
      policy: canonicalize(context.policy),
      evidence: Array.isArray(context.evidence) ? context.evidence.map(canonicalize) : [],
    };
    if (context.brandKitSnapshot) snapshot.brandKitSnapshot = canonicalize(context.brandKitSnapshot);
    snapshot.contextRevision = 'ctx-' + hash(snapshot);
    return freeze(snapshot);
  }

  function resolveBatchSize(policy, requestedCount) {
    const configured = policy && policy.batchSize || {};
    const fallback = Number.isInteger(policy && policy.cadencePerWeek) ? policy.cadencePerWeek : 5;
    const minimum = Number.isInteger(configured.min) ? configured.min : 1;
    const maximum = Number.isInteger(configured.max) ? configured.max : Math.max(fallback, 20);
    const defaultSize = Number.isInteger(configured.default) ? configured.default : fallback;
    const size = requestedCount == null || requestedCount === '' ? defaultSize : Number(requestedCount);
    assert(Number.isInteger(size), 'Requested batch size must be an integer.');
    assert(size >= minimum && size <= maximum, 'Requested batch size must be between ' + minimum + ' and ' + maximum + '.');
    return size;
  }

  function createWeeklyBatch({ id, snapshot, topics, ideas }) {
    assert(id, 'Batch id is required.');
    assert(snapshot && snapshot.contextRevision, 'A context snapshot is required.');
    const source = Array.isArray(ideas) ? ideas : Array.isArray(topics)
      ? topics.map((topic) => ({ title: String(topic), angle: '' })) : [];
    assert(source.length > 0, 'A batch requires at least one generated idea.');
    return freeze({
      contractVersion: '1.0',
      id,
      contextRevision: snapshot.contextRevision,
      requestedCount: source.length,
      status: 'queued',
      drafts: source.map((idea, index) => {
        const postId = 'post-' + String(index + 1).padStart(2, '0');
        return freeze({
          id: postId,
          topic: String(idea && idea.title || ''),
          angle: String(idea && idea.angle || ''),
          status: 'idea_queued',
          revision: 1,
          clientRef: id + '/' + postId + '/r1',
        });
      }),
    });
  }

  function canonicalClaim(text) {
    return String(text || '').toLocaleLowerCase('vi').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function namedEntities(text) {
    const value = String(text || '').normalize('NFC');
    const entityStop = new Set(['Theo', 'Một', 'Bạn', 'Hãy', 'Nếu', 'Khi', 'Use', 'The', 'A', 'An', 'In']);
    return (value.match(/[\p{Lu}][\p{L}\p{N}._-]*/gu) || []).filter((item) => !entityStop.has(item) && item !== item.toLocaleUpperCase('vi'));
  }

  function isFactualSentence(sentence) {
    const text = String(sentence || '');
    const numbers = /\d/u;
    const attribution = /\b(?:according to|research|study|report|data|official|documentation)\b|(?:theo (?:nghiên cứu|báo cáo|số liệu|tài liệu)|nghiên cứu|báo cáo|số liệu|chính thức|tài liệu)/iu;
    const assertion = /\b(?:is|are|was|were|has|have|uses?|causes?|increases?|decreases?|ranks?|requires?|supports?|guarantees?|can)\b|(?:\blà\b|\bcó\b|sử dụng|gây ra|tăng|giảm|ảnh hưởng|xếp hạng|yêu cầu|hỗ trợ|đảm bảo|cam kết)/iu;
    return numbers.test(text) || attribution.test(text) || assertion.test(text) || namedEntities(text).length > 0;
  }

  function isHardFactualSentence(sentence) {
    const text = String(sentence || '');
    return /\d/u.test(text)
      || /\b(?:according to|research|study|report|data|official|documentation)\b|(?:theo (?:nghiên cứu|báo cáo|số liệu|tài liệu)|nghiên cứu|báo cáo|số liệu|chính thức|tài liệu)/iu.test(text)
      || namedEntities(text).length > 0;
  }

  function isExplicitOpinionOrAdvice(sentence) {
    return /\?|(?:theo (?:tôi|mình)|mình nghĩ|tôi nghĩ|góc nhìn|quan điểm|kinh nghiệm (?:của )?(?:tôi|mình|cá nhân)|hãy|nên|thử|đừng|bạn có thể|cùng thảo luận|chia sẻ)|\b(?:in my view|i think|my experience|consider|try|use|you can)\b/iu.test(String(sentence || ''));
  }

  function brandVoiceChecks(draft, brandProfile, evidenceIssues) {
    const voice = Array.isArray(brandProfile && brandProfile.voice) ? brandProfile.voice : [];
    const copy = String(draft && draft.copy || '');
    const words = copy.trim().split(/\s+/u).filter(Boolean);
    const sentences = copy.split(/[.!?\n]+/u).map((item) => item.trim()).filter(Boolean);
    const maxSentenceWords = sentences.reduce((max, sentence) => Math.max(max, sentence.split(/\s+/u).filter(Boolean).length), 0);
    const disrespectful = /(?:ngu ngốc|đồ ngốc|vô dụng|dốt|idiot|stupid|moron)/iu.test(copy);
    const checks = voice.map((item) => {
      const key = String(item).toLocaleLowerCase('vi');
      if (key === 'practical') return { voice: item, pass: Boolean(String(draft && draft.cta || '').trim()), criterion: 'non-empty CTA' };
      if (key === 'evidence-led') return { voice: item, pass: evidenceIssues.length === 0, criterion: 'all factual claims mapped to canonical evidence' };
      if (key === 'clear') return { voice: item, pass: words.length <= 800 && maxSentenceWords <= 60, criterion: 'copy <= 800 words and every sentence <= 60 words' };
      if (key === 'respectful') return { voice: item, pass: !disrespectful, criterion: 'no insulting or demeaning language' };
      return { voice: item, pass: true, criterion: 'prompt-enforced voice; no deterministic rule configured' };
    });
    return checks;
  }

  function validateDraftPackage(draft, evidence, options) {
    const evidenceById = new Map((evidence || []).map((item) => [item && item.id, item]).filter((item) => item[0]));
    const knownEvidence = new Set(evidenceById.keys());
    const issues = [];
    const sentences = (String(draft && draft.copy || '').match(/[^.!?\n]+[.!?]?/gu) || []).map((sentence) => sentence.trim()).filter(Boolean);
    const canonicalSentences = new Set(sentences.map(canonicalClaim).filter(Boolean));
    (draft && draft.claims || []).forEach((claim, claimIndex) => {
      if (!claim || !claim.evidenceId || !knownEvidence.has(claim.evidenceId)) {
        issues.push({ code: 'MISSING_EVIDENCE', claimIndex });
      } else if (!canonicalClaim(claim.text) || canonicalClaim(claim.text) !== canonicalClaim(evidenceById.get(claim.evidenceId).claim)) {
        issues.push({ code: 'EVIDENCE_MISMATCH', claimIndex, evidenceId: claim.evidenceId });
      } else if (!canonicalSentences.has(canonicalClaim(claim.text))) {
        issues.push({ code: 'CLAIM_NOT_VERBATIM_IN_COPY', claimIndex, evidenceId: claim.evidenceId });
      }
    });
    const strictEvidence = options && options.requiredEvidence === true;
    sentences.forEach((sentence, sentenceIndex) => {
      const explicitOpinion = isExplicitOpinionOrAdvice(sentence);
      const requiresClaim = isHardFactualSentence(sentence) || (!explicitOpinion && (isFactualSentence(sentence) || strictEvidence));
      if (requiresClaim && !(draft && draft.claims || []).some((claim) => canonicalClaim(sentence) === canonicalClaim(claim && claim.text))) {
        issues.push({ code: 'UNMAPPED_CLAIM', sentenceIndex });
      }
    });
    if (!draft || !String(draft.copy || '').trim()) issues.push({ code: 'MISSING_COPY' });
    const expectedLanguage = options && options.expectedLanguage;
    const looksVietnamese = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]|\b(?:bạn|mình|chúng ta|không|đang|và|của|cho|với)\b/iu.test(String(draft && draft.copy || ''));
    if (expectedLanguage === 'vi' && !looksVietnamese) issues.push({ code: 'LANGUAGE_MISMATCH', expected: 'vi' });
    const brief = draft && draft.creativeBrief;
    if (!brief || !String(brief.visualPrompt || '').trim() || !String(brief.ratio || '').trim()) issues.push({ code: 'MISSING_CREATIVE_BRIEF' });
    const evidenceIssues = issues.filter((issue) => ['MISSING_EVIDENCE', 'EVIDENCE_MISMATCH', 'CLAIM_NOT_VERBATIM_IN_COPY', 'UNMAPPED_CLAIM'].includes(issue.code));
    const brandChecks = brandVoiceChecks(draft, options && options.brandProfile, evidenceIssues);
    brandChecks.filter((check) => !check.pass).forEach((check) => issues.push({ code: 'BRAND_VOICE_MISMATCH', voice: check.voice }));
    const copyQa = {
      verdict: issues.length ? 'blocked' : 'pass',
      language: expectedLanguage || null,
      claimCount: (draft && draft.claims || []).length,
      evidenceRevision: options && options.contextRevision || null,
      brandProfileId: options && options.brandProfile && options.brandProfile.id || null,
      brandChecks: canonicalize(brandChecks),
      issues: canonicalize(issues),
    };
    if (issues.length) return { ok: false, issues, copyQa };
    const brandKit = options && options.brandKitSnapshot;
    const mode = String(brief.mode || 'lightEditorial');
    const component = String(brief.component || 'explain_light');
    if (brandKit) {
      assert(brandKit.visualModes && brandKit.visualModes[mode], 'Creative brief uses an unapproved BrandKit mode.');
      assert(Array.isArray(brandKit.components) && brandKit.components.includes(component), 'Creative brief uses an unapproved BrandKit component.');
    }
    const palette = brandKit && brandKit.palette || {};
    const brandPrompt = brandKit ? [
      'SEOSONA BrandKit v' + brandKit.version + ' (sha256 ' + brandKit.sha256 + ').',
      'Visual mode: ' + mode + '. Approved component: ' + component + '.',
      'Compositor palette guidance: ' + [palette.identityBlue, palette.heroBlueStart, palette.heroBlueEnd, palette.identityGreen].filter(Boolean).join(', ') + '.',
      String(brandKit.typography && brandKit.typography.family || 'Be Vietnam Pro') + ' is compositor-only typography guidance; do not render text.',
      'Flow boundary: generate text-free scene imagery only. A deterministic compositor owns all Vietnamese text, logos and wordmarks, statistics, citations, and UI labels.',
      'Negative rules: ' + brandKit.negativeRules.join(' '),
    ].join(' ') : '';
    const visualJob = {
      clientRef: options && options.clientRef || String(draft.id) + '/r1',
      prompt: [String(brief.visualPrompt).trim(), brandPrompt].filter(Boolean).join(' '),
      ratio: String(brief.ratio).trim(),
      qualityGate: true,
    };
    if (brandKit) {
      visualJob.brandKitRef = { ref: brandKit.ref, version: brandKit.version, sha256: brandKit.sha256 };
      visualJob.mode = mode;
      visualJob.component = component;
      visualJob.allowedAssets = [];
      visualJob.negativeRules = canonicalize(brandKit.negativeRules);
    }
    return {
      ok: true,
      issues: [],
      copyQa,
      visualJob: visualJob,
    };
  }

  function nextAssetAction(quality, retryCount) {
    const retries = Number.isInteger(retryCount) && retryCount >= 0 ? retryCount : 0;
    if (!quality || quality.judged !== true) return { type: 'asset_needs_review', retryCount: retries };
    if (quality.pass === true) return { type: 'asset_ready', retryCount: retries };
    if (quality.pass !== false) return { type: 'asset_needs_review', retryCount: retries };
    if (!['rewrite_prompt', 'regen_image'].includes(quality.action) || retries >= 2) return { type: 'asset_needs_review', retryCount: retries };
    return { type: 'retry', retryCount: retries + 1 };
  }

  function createAssetReceipt({ batchId, draftId, asset, quality, retryCount, promptRevision, brandKitRef }) {
    assert(batchId && draftId && asset && asset.asset_id, 'Asset receipt requires batch, draft, and asset id.');
    const receipt = {
      id: batchId + '/' + draftId + '/' + asset.asset_id,
      assetId: asset.asset_id,
      kind: asset.kind,
      fileName: asset.file_name,
      provider: asset.provider,
      quality: canonicalize(quality || null),
      retryCount: Number.isInteger(retryCount) ? retryCount : 0,
      promptRevision: Number.isInteger(promptRevision) && promptRevision > 0 ? promptRevision : 1,
    };
    if (brandKitRef) receipt.brandKitRef = canonicalize(brandKitRef);
    return freeze(receipt);
  }

  return { createContextSnapshot, resolveBatchSize, createWeeklyBatch, validateDraftPackage, nextAssetAction, createAssetReceipt };
});
