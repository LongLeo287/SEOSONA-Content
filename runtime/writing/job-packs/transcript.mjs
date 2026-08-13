import { buildBrief } from '../brief.mjs';
import { assertSpecializedContent } from '../contracts.mjs';
import { validateTranscriptSelection } from '../transcript/srt.mjs';

// Job Pack: transcript / SRT.
//
// Nguồn sự thật ở đây là bản ghi lời nói: chữ nguyên văn và mốc thời gian gốc. Mọi thao tác
// đều phải giải ngược về được các cue có thật.
//
// Mỗi thao tác có HỢP ĐỒNG RIÊNG. Gộp cả sáu vào một schema chung sẽ khiến mọi trường thành
// tùy chọn (vì thao tác này cần cái mà thao tác kia không cần), và khi mọi trường đều tùy chọn
// thì thực chất không còn gì được kiểm.

const OPERATIONS = Object.freeze(['HIGHLIGHTS', 'SHORT_CUT', 'CLEAN_TRANSCRIPT', 'QUOTES', 'CHAPTERS', 'REPURPOSE_ARTICLE']);
const REQUIRED_BRIEF_FIELDS = ['objective', 'intent'];

const cueMapOf = (transcript) => new Map((transcript?.cues || []).map((c) => [c.cueId, c]));

function unknownCue(cueId, extra = {}) {
  return { code: 'UNKNOWN_CUE', cueId, repairAction: 'RESTORE_SOURCE_FACT', ...extra };
}

// Mỗi thao tác: một hàm kiểm, không dùng chung.
const VALIDATORS = {
  // Bản cắt ngắn — thao tác nguy hiểm nhất, vì đầu ra của nó điều khiển phần mềm dựng phim.
  SHORT_CUT(fields, transcript) {
    const selections = fields.selections || [];
    if (!selections.length) return [{ code: 'EMPTY_OUTPUT', repairAction: 'HUMAN_REVIEW' }];

    const issues = [];
    for (const [index, selection] of selections.entries()) {
      // Timecode tự do là cách một bản cắt lệch khỏi video mà không ai thấy: con số trông
      // hợp lý, và chỉ đến lúc dựng mới biết nó trỏ vào chỗ khác. Chỉ cueId mới truy được.
      if (!Array.isArray(selection?.cueIds) || !selection.cueIds.length) {
        issues.push({ code: 'FREEFORM_TIMECODE', selectionIndex: index, repairAction: 'RESTORE_SOURCE_FACT' });
      }
    }
    if (issues.length) return issues;

    // editorOverlay (chữ hiển thị trên hình) là LỚP PHỦ, không đụng tới lời thoại gốc,
    // nên nó được phép tồn tại mà bản cắt vẫn chính xác.
    return validateTranscriptSelection({ cues: transcript?.cues || [], selections }).issues;
  },

  // Dọn transcript: được sửa chữ HIỂN THỊ, nhưng bản gốc không bị thay.
  CLEAN_TRANSCRIPT(fields, transcript) {
    const lines = fields.lines || [];
    if (!lines.length) return [{ code: 'EMPTY_OUTPUT', repairAction: 'HUMAN_REVIEW' }];
    const cueById = cueMapOf(transcript);
    const issues = [];

    for (const [index, line] of lines.entries()) {
      if (!line?.cueId) {
        // Một câu đã dọn mà không gắn cue nào thì không còn đường về nguồn: không ai đối chiếu
        // được nó với lời nói thật nữa.
        issues.push({ code: 'MISSING_CUE_REFERENCE', index, repairAction: 'RESTORE_SOURCE_FACT' });
        continue;
      }
      if (!cueById.has(line.cueId)) issues.push(unknownCue(line.cueId, { index }));
      if (!String(line.displayText || '').trim()) {
        issues.push({ code: 'EMPTY_DISPLAY_TEXT', index, repairAction: 'REWRITE_SECTION' });
      }
    }
    return issues;
  },

  QUOTES(fields, transcript) {
    const quotes = fields.quotes || fields.selections || [];
    if (!quotes.length) return [{ code: 'EMPTY_OUTPUT', repairAction: 'HUMAN_REVIEW' }];
    const cueById = cueMapOf(transcript);
    const issues = [];

    for (const [index, quote] of quotes.entries()) {
      const cueIds = quote?.cueIds || [];
      if (!cueIds.length) { issues.push({ code: 'MISSING_CUE_REFERENCE', index, repairAction: 'RESTORE_SOURCE_FACT' }); continue; }

      const resolved = cueIds.map((id) => cueById.get(id));
      const missing = cueIds.find((id) => !cueById.has(id));
      if (missing) { issues.push(unknownCue(missing, { index })); continue; }

      // Trích dẫn là "người này đã nói đúng câu này". Sửa một chữ trong ngoặc kép là đặt lời
      // vào miệng người khác — trừ khi nói rõ đây là diễn giải.
      if (quote.paraphrase === true) continue;
      const exact = resolved.map((c) => c.rawText).join('\n');
      if (quote.text !== exact) {
        issues.push({ code: 'QUOTE_NOT_VERBATIM', index, repairAction: 'RESTORE_SOURCE_FACT' });
      }
    }
    return issues;
  },

  HIGHLIGHTS(fields, transcript) {
    const highlights = fields.highlights || [];
    if (!highlights.length) return [{ code: 'EMPTY_OUTPUT', repairAction: 'HUMAN_REVIEW' }];
    const cueById = cueMapOf(transcript);
    const issues = [];
    for (const [index, highlight] of highlights.entries()) {
      const cueIds = highlight?.cueIds || [];
      if (!cueIds.length) { issues.push({ code: 'MISSING_CUE_REFERENCE', index, repairAction: 'RESTORE_SOURCE_FACT' }); continue; }
      for (const cueId of cueIds) if (!cueById.has(cueId)) issues.push(unknownCue(cueId, { index }));
    }
    return issues;
  },

  CHAPTERS(fields, transcript) {
    const chapters = fields.chapters || [];
    if (!chapters.length) return [{ code: 'EMPTY_OUTPUT', repairAction: 'HUMAN_REVIEW' }];
    const cueById = cueMapOf(transcript);
    const issues = [];
    let previousStart = -1;

    for (const [index, chapter] of chapters.entries()) {
      if (!String(chapter?.title || '').trim()) {
        issues.push({ code: 'MISSING_CHAPTER_TITLE', index, repairAction: 'REWRITE_SECTION' });
      }
      const cue = cueById.get(chapter?.startCueId);
      if (!cue) { issues.push(unknownCue(chapter?.startCueId, { index })); continue; }
      // Mục lục nhảy lung tung là mục lục vô dụng: người xem bấm vào chương 2 và quay về đầu video.
      if (cue.startMs <= previousStart) {
        issues.push({ code: 'CHAPTERS_OUT_OF_ORDER', index, repairAction: 'FIX_STRUCTURE' });
      }
      previousStart = cue.startMs;
    }
    return issues;
  },

  REPURPOSE_ARTICLE(fields, transcript) {
    const sections = fields.sections || [];
    if (!String(fields.title || '').trim()) return [{ code: 'MISSING_REQUIRED_FIELD', field: 'title', repairAction: 'REWRITE_SECTION' }];
    if (!sections.length) return [{ code: 'EMPTY_OUTPUT', repairAction: 'HUMAN_REVIEW' }];

    const cueById = cueMapOf(transcript);
    const issues = [];
    for (const [index, section] of sections.entries()) {
      const cueIds = section?.cueIds || [];
      if (!cueIds.length) {
        // Bài viết dựng từ transcript mà không dẫn cue nào thì mọi con số trong đó đến từ đâu?
        // Câu trả lời thường là: model tự nghĩ ra.
        issues.push({ code: 'SECTION_WITHOUT_CUE_REFERENCE', index, heading: section?.heading, repairAction: 'ADD_EVIDENCE' });
        continue;
      }
      for (const cueId of cueIds) if (!cueById.has(cueId)) issues.push(unknownCue(cueId, { index }));
    }
    return issues;
  },
};

function validateTranscriptFields(content) {
  const operation = content.fields?.operation;
  if (!OPERATIONS.includes(operation)) {
    throw new TypeError(`transcriptContent: "operation" must be one of ${OPERATIONS.join(', ')}.`);
  }
  return content;
}

export const transcriptPack = {
  id: 'job.transcript',
  version: '1.0.0',
  jobType: 'transcript',
  operations: OPERATIONS,
  requiredBriefFields: REQUIRED_BRIEF_FIELDS,
  requiredCapabilities: ['long-context', 'structured-output'],

  outputContract: {
    format: 'json',
    // Hợp đồng khai rõ: hình dạng đầu ra PHỤ THUỘC thao tác. Không hứa một schema chung.
    jsonSchema: {
      name: 'transcript_output',
      schema: {
        type: 'object',
        required: ['operation'],
        properties: {
          operation: { type: 'string', enum: [...OPERATIONS] },
          selections: {
            type: 'array',
            items: {
              type: 'object',
              required: ['cueIds', 'sourceStartMs', 'sourceEndMs', 'rawTranscript'],
              properties: {
                cueIds: { type: 'array', items: { type: 'string' } },
                sourceStartMs: { type: 'integer' },
                sourceEndMs: { type: 'integer' },
                rawTranscript: { type: 'string' },
                editorOverlay: { type: 'string' },
              },
            },
          },
          lines: { type: 'array', items: { type: 'object', required: ['cueId', 'displayText'] } },
          quotes: { type: 'array', items: { type: 'object', required: ['cueIds', 'text'] } },
          highlights: { type: 'array', items: { type: 'object', required: ['cueIds'] } },
          chapters: { type: 'array', items: { type: 'object', required: ['title', 'startCueId'] } },
          title: { type: 'string' },
          sections: { type: 'array', items: { type: 'object', required: ['heading', 'body', 'cueIds'] } },
        },
      },
    },
  },

  // Lời thoại nguyên văn và mốc thời gian: sửa văn chung không được đụng vào.
  immutableFields: ['selections', 'quotes'],

  structureRules: {},

  rules: [
    'Chỉ được chọn nội dung bằng cueId. Không tự viết ra mốc thời gian.',
    'rawTranscript phải sao đúng nguyên văn lời thoại của các cue đã chọn, kể cả lỗi chính tả.',
    'Muốn hiển thị chữ đã sửa thì dùng editorOverlay hoặc thao tác CLEAN_TRANSCRIPT; không sửa vào bản gốc.',
    'Trích dẫn phải đúng từng chữ, trừ khi đánh dấu paraphrase.',
  ],

  requiredEvaluators: ['factuality', 'job-specific', 'audience'],

  buildBrief(input) {
    return buildBrief({ ...input, jobType: 'transcript' }, REQUIRED_BRIEF_FIELDS);
  },

  validateDraft(contentIR, context = {}) {
    const content = assertSpecializedContent(contentIR, validateTranscriptFields);
    const issues = VALIDATORS[content.fields.operation](content.fields, context.transcript);
    return { ok: issues.length === 0, issues };
  },

  /**
   * Cổng cuối trước khi lưu: giải mọi cueId về lại transcript và đối chiếu lần nữa.
   *
   * Kiểm hai lần là CÓ CHỦ Ý — giữa lúc duyệt và lúc lưu, bản thảo còn có thể đi qua một
   * bước sửa khác, và bước đó không được phép làm bản cắt lệch khỏi nguồn.
   */
  assertSourceFidelity(contentIR, transcript) {
    const content = assertSpecializedContent(contentIR, validateTranscriptFields);
    const issues = [];

    // Bản cắt phải được đối chiếu với ĐÚNG transcript mà nó sinh ra từ đó, không phải một
    // transcript khác trông tương tự.
    if (transcript?.sourceId && content.sourceRefs.length && !content.sourceRefs.includes(transcript.sourceId)) {
      issues.push({
        code: 'TRANSCRIPT_SOURCE_MISMATCH', field: 'sourceId',
        expected: content.sourceRefs, actual: transcript.sourceId, repairAction: 'RESTORE_SOURCE_FACT',
      });
      return { ok: false, issues };
    }

    issues.push(...VALIDATORS[content.fields.operation](content.fields, transcript));
    return { ok: issues.length === 0, issues };
  },

  definitionOfDone(contentIR, evaluations = []) {
    const byDimension = new Map(evaluations.map((e) => [e.dimension, e]));
    const blocking = [];
    for (const dimension of this.requiredEvaluators) {
      const evaluation = byDimension.get(dimension);
      if (!evaluation) { blocking.push({ code: 'EVALUATION_MISSING', dimension }); continue; }
      if (evaluation.verdict === 'BLOCK') blocking.push({ code: 'EVALUATION_BLOCKED', dimension });
      if (evaluation.verdict === 'REVIEW') blocking.push({ code: 'HUMAN_REVIEW_REQUIRED', dimension });
    }
    return { done: blocking.length === 0, blocking };
  },
};
