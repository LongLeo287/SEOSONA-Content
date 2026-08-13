import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, serializeSrt, timeToMs, msToTime, normalizeForMatching, validateTranscriptSelection } from '../runtime/writing/transcript/srt.mjs';
import { transcriptPack } from '../runtime/writing/job-packs/transcript.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(here, 'fixtures/transcript-exact.srt'), 'utf8');
const cues = parseSrt(RAW);

// exporter.js là script trình duyệt và dựa vào SrtLib toàn cục. Nạp cả hai trong một phạm vi
// thay vì sửa file production chỉ để test chạy được.
async function loadExporter() {
  const srtLib = readFileSync(join(here, '../extension/lib/srt-parser.js'), 'utf8');
  const exporter = readFileSync(join(here, '../extension/lib/exporter.js'), 'utf8')
    .replace(/if \(typeof module[\s\S]*$/, '');
  // eslint-disable-next-line no-new-func
  return new Function(`${srtLib}\n${exporter}\nreturn { Exporter, RuntimeExportSource };`)();
}

// ================================================================ Timecode

test('timecodes parse with either a comma or a dot', () => {
  assert.equal(timeToMs('00:00:04,250'), 4250);
  assert.equal(timeToMs('00:00:04.250'), 4250);
  assert.equal(timeToMs('01:02:03,004'), 3723004);
  assert.equal(timeToMs('not a timecode'), null);
  assert.equal(timeToMs(''), null);
});

test('milliseconds are padded, not truncated', () => {
  assert.equal(timeToMs('00:00:01,5'), 1500, '",5" means 500ms, not 5ms');
  assert.equal(msToTime(4250), '00:00:04,250');
  assert.equal(msToTime(0), '00:00:00,000');
  assert.equal(msToTime(-10), '00:00:00,000', 'a negative time is clamped, not rendered as garbage');
});

// ================================================================ Đọc file

test('every cue is parsed with an id, an index and exact boundaries', () => {
  assert.equal(cues.length, 5);
  assert.equal(cues[0].index, 1);
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 4250);
  assert.ok(cues[0].cueId, 'each cue is addressable');
  assert.equal(new Set(cues.map((c) => c.cueId)).size, 5, 'cue ids are unique');
});

// Đây là bất biến trung tâm của cả pack: chữ trong transcript là NGUYÊN VĂN.
test('rawText is exactly what the file said', () => {
  assert.equal(cues[0].rawText, 'Chào bạn, hôm nay chúng ta nói về tốc độ giao hàng.');
  assert.equal(cues[2].rawText, 'Theo số liệu nội bộ, 87% khách bỏ giỏ khi chờ quá 3 ngày.');
});

test('diacritics, punctuation and quotation marks survive untouched', () => {
  assert.ok(cues[3].rawText.includes('"cửa sổ kiên nhẫn"'));
  assert.ok(cues[3].rawText.includes('—'));
});

// Sửa chính tả trong trường nguyên văn là cách nhanh nhất để một bản cắt không còn khớp
// với video gốc — và không ai biết đã có gì bị đổi.
test('a spelling error in the source is preserved, never quietly corrected', () => {
  assert.ok(cues[4].rawText.includes('logictics'), 'the misspelling stays in the authoritative field');
  assert.ok(!cues[4].rawText.includes('logistics ') || cues[4].rawText.includes('logictics'));
});

test('a multi line cue keeps its line break', () => {
  assert.equal(cues[1].rawText, 'Nhiều shop nghĩ rằng cứ gom đơn là xong,\nnhưng thực tế phức tạp hơn thế nhiều.');
  assert.equal(cues[1].rawText.split('\n').length, 2);
});

test('dot form milliseconds parse the same as comma form', () => {
  assert.equal(cues[2].startMs, 9500);
  assert.equal(cues[2].endMs, 13750);
});

test('adjacent cues keep their exact boundary, with no invented gap', () => {
  assert.equal(cues[0].endMs, cues[1].startMs, 'cue 1 ends exactly where cue 2 starts');
  assert.equal(cues[3].endMs, cues[4].startMs);
});

test('parsing is stable: the same input always yields the same cues', () => {
  assert.deepEqual(parseSrt(RAW), cues);
});

test('an empty or malformed input yields no cues instead of throwing', () => {
  assert.deepEqual(parseSrt(''), []);
  assert.deepEqual(parseSrt(null), []);
  assert.deepEqual(parseSrt('không có timecode nào ở đây'), []);
});

test('a byte order mark and windows line endings do not leak into the text', () => {
  const withBom = `﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nXin chào\r\n`;
  const parsed = parseSrt(withBom);
  assert.equal(parsed[0].rawText, 'Xin chào');
});

// Chuẩn hóa TỒN TẠI, nhưng chỉ để đối chiếu — không bao giờ là đầu ra chính thức.
test('normalization is available for matching but is kept away from the authoritative field', () => {
  assert.equal(normalizeForMatching('  Xin   CHÀO  '), 'xin chào');
  assert.equal(cues[0].rawText, 'Chào bạn, hôm nay chúng ta nói về tốc độ giao hàng.', 'the cue itself is untouched');
});

// ================================================================ Ghi file

test('serializing renumbers cues and round trips the text', () => {
  const output = serializeSrt(cues);
  const reparsed = parseSrt(output);
  assert.deepEqual(reparsed.map((c) => c.rawText), cues.map((c) => c.rawText));
  assert.deepEqual(reparsed.map((c) => c.startMs), cues.map((c) => c.startMs));
  assert.deepEqual(reparsed.map((c) => c.endMs), cues.map((c) => c.endMs));
});

test('a non linear selection serializes in the order given, with fresh numbering', () => {
  const output = serializeSrt([cues[2], cues[0]]);
  assert.match(output, /^1\n/);
  assert.ok(output.includes(cues[2].rawText));
  assert.equal(parseSrt(output)[0].rawText, cues[2].rawText);
});

// ================================================================ Đối chiếu bản chọn

const selection = (overrides = {}) => ({
  cueIds: [cues[0].cueId, cues[1].cueId],
  sourceStartMs: cues[0].startMs,
  sourceEndMs: cues[1].endMs,
  rawTranscript: `${cues[0].rawText}\n${cues[1].rawText}`,
  ...overrides,
});

test('a selection that matches the source exactly passes', () => {
  assert.deepEqual(validateTranscriptSelection({ cues, selections: [selection()] }), { ok: true, issues: [] });
});

test('cues chosen out of order are allowed', () => {
  const nonLinear = selection({
    cueIds: [cues[3].cueId, cues[0].cueId],
    sourceStartMs: cues[3].startMs,
    sourceEndMs: cues[0].endMs,
    rawTranscript: `${cues[3].rawText}\n${cues[0].rawText}`,
  });
  assert.equal(validateTranscriptSelection({ cues, selections: [nonLinear] }).ok, true, 'reordering is editing, not falsifying');
});

// Một timecode "gần đúng" là một bản cắt lệch khỏi video. Không có ngưỡng dung sai nào cả.
test('an invented timestamp is rejected even when it is close', () => {
  const result = validateTranscriptSelection({ cues, selections: [selection({ sourceStartMs: 1001 })] });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'TRANSCRIPT_SOURCE_MISMATCH');
  assert.equal(result.issues[0].field, 'sourceStartMs');
});

test('a merged span that no cue boundary supports is rejected', () => {
  // 11000ms rơi vào GIỮA cue 3 — không phải mốc kết thúc của cue nào trong bản chọn.
  const merged = selection({ sourceEndMs: 11000 });
  const result = validateTranscriptSelection({ cues, selections: [merged] });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].field, 'sourceEndMs');
});

test('text that was tidied up no longer matches the source', () => {
  const tidied = selection({ rawTranscript: 'Chào bạn, hôm nay chúng ta nói về tốc độ giao hàng. Nhiều shop nghĩ rằng cứ gom đơn là xong, nhưng thực tế phức tạp hơn thế nhiều.' });
  const result = validateTranscriptSelection({ cues, selections: [tidied] });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].field, 'rawTranscript');
  assert.equal(result.issues[0].repairAction, 'RESTORE_SOURCE_FACT');
});

test('even a corrected spelling breaks the match', () => {
  const corrected = {
    cueIds: [cues[4].cueId],
    sourceStartMs: cues[4].startMs,
    sourceEndMs: cues[4].endMs,
    rawTranscript: cues[4].rawText.replace('logictics', 'logistics'),
  };
  assert.equal(validateTranscriptSelection({ cues, selections: [corrected] }).ok, false);
});

test('a cue id that does not exist is reported clearly', () => {
  const result = validateTranscriptSelection({ cues, selections: [selection({ cueIds: ['cue_khong_co'] })] });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'UNKNOWN_CUE');
});

test('an empty selection is not silently accepted', () => {
  const result = validateTranscriptSelection({ cues, selections: [selection({ cueIds: [] })] });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'EMPTY_SELECTION');
});

test('every selection is checked, not just the first', () => {
  const result = validateTranscriptSelection({
    cues,
    selections: [selection(), selection({ sourceStartMs: 999 }), selection({ cueIds: ['nope'] })],
  });
  assert.equal(result.issues.length, 2);
  assert.deepEqual(result.issues.map((i) => i.selectionIndex), [1, 2]);
});

// ================================================================ Đối chiếu với parser cũ

// Parser cũ trong extension cắt khoảng trắng đầu/cuối mỗi dòng. Với side panel thì vô hại,
// nhưng với trường NGUYÊN VĂN thì đó là một phép chuẩn hóa — nên bản Runtime cố ý không làm.
// Test này khóa cả phần GIỐNG NHAU lẫn phần KHÁC BIỆT CÓ CHỦ Ý.
test('runtime parsing matches the legacy parser on timecodes and cue count', async () => {
  const { readFileSync: read } = await import('node:fs');
  const legacySource = read(join(here, '../extension/lib/srt-parser.js'), 'utf8');
  const legacy = new Function(`${legacySource}\nreturn SrtLib;`)();

  const legacyCues = legacy.parse(RAW);
  assert.equal(legacyCues.length, cues.length, 'the same cues are found');
  assert.deepEqual(legacyCues.map((c) => c.start), cues.map((c) => c.startMs));
  assert.deepEqual(legacyCues.map((c) => c.end), cues.map((c) => c.endMs));
  assert.deepEqual(legacyCues.map((c) => c.text), cues.map((c) => c.rawText), 'and the same text on this fixture');
});

test('the runtime parser does not trim inside an authoritative cue', () => {
  const indented = '1\n00:00:01,000 --> 00:00:02,000\n   Có thụt đầu dòng   \n';
  assert.equal(parseSrt(indented)[0].rawText, '   Có thụt đầu dòng   ', 'whitespace is part of the source');
});

// ================================================================ Transcript Job Pack

const transcript = {
  sourceId: 's_video', cues, durationMs: cues.at(-1).endMs, language: 'vi-VN',
};

const draft = (operation, fields, overrides = {}) => ({
  contentId: 'content_1',
  jobType: 'transcript',
  fields: { operation, ...fields },
  sourceRefs: ['s_video'],
  claimRefs: [],
  ...overrides,
});

const packContext = { transcript };

test('the pack declares the V1 operations and nothing more', () => {
  assert.deepEqual(transcriptPack.operations, [
    'HIGHLIGHTS', 'SHORT_CUT', 'CLEAN_TRANSCRIPT', 'QUOTES', 'CHAPTERS', 'REPURPOSE_ARTICLE',
  ]);
  assert.equal(transcriptPack.jobType, 'transcript');
  assert.throws(
    () => transcriptPack.validateDraft(draft('DUB', {}), packContext),
    /operation/,
  );
});

// Mỗi thao tác có hợp đồng riêng. Một schema chung cho cả sáu sẽ khiến mọi trường thành
// tùy chọn, và khi mọi trường đều tùy chọn thì không còn gì được kiểm.
test('each operation is validated against its own contract, not one shared blob', () => {
  const shortCut = draft('SHORT_CUT', { selections: [] });
  assert.ok(transcriptPack.validateDraft(shortCut, packContext).issues.some((i) => i.code === 'EMPTY_OUTPUT'));

  const quotes = draft('QUOTES', { selections: [] });
  assert.ok(transcriptPack.validateDraft(quotes, packContext).issues.some((i) => i.code === 'EMPTY_OUTPUT'));

  // Trường của thao tác này không được dùng để thoả mãn thao tác kia.
  const wrongShape = draft('SHORT_CUT', { quotes: [{ text: 'x' }] });
  assert.equal(transcriptPack.validateDraft(wrongShape, packContext).ok, false);
});

// ---------------------------------------------------------------- SHORT_CUT

const shortCutSelection = () => ({
  cueIds: [cues[0].cueId, cues[1].cueId],
  sourceStartMs: cues[0].startMs,
  sourceEndMs: cues[1].endMs,
  rawTranscript: `${cues[0].rawText}\n${cues[1].rawText}`,
});

test('a short cut built from real cues passes', () => {
  const result = transcriptPack.validateDraft(draft('SHORT_CUT', { selections: [shortCutSelection()] }), packContext);
  assert.deepEqual(result, { ok: true, issues: [] });
});

// Timecode tự do là cách một bản cắt lệch khỏi video mà không ai thấy: con số trông hợp lý,
// và chỉ đến lúc dựng mới biết nó trỏ vào chỗ khác.
test('a short cut with freeform timecodes instead of cue ids is rejected', () => {
  const freeform = { sourceStartMs: 1000, sourceEndMs: 9500, rawTranscript: 'gì đó' };
  const result = transcriptPack.validateDraft(draft('SHORT_CUT', { selections: [freeform] }), packContext);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === 'EMPTY_SELECTION' || i.code === 'FREEFORM_TIMECODE'));
});

test('a short cut whose transcript was tidied up is blocked', () => {
  const edited = { ...shortCutSelection(), rawTranscript: 'Chào bạn. Nhiều shop nghĩ gom đơn là xong.' };
  const result = transcriptPack.validateDraft(draft('SHORT_CUT', { selections: [edited] }), packContext);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'TRANSCRIPT_SOURCE_MISMATCH');
});

// Chữ hiển thị trên video là một LỚP PHỦ, tách khỏi lời thoại gốc. Có nó thì vẫn dựng đúng
// được, vì bản gốc không bị đụng tới.
test('an editor overlay is allowed as long as the source fields stay exact', () => {
  const withOverlay = { ...shortCutSelection(), editorOverlay: 'Tốc độ giao hàng quyết định giỏ hàng' };
  assert.equal(transcriptPack.validateDraft(draft('SHORT_CUT', { selections: [withOverlay] }), packContext).ok, true);
});

// ---------------------------------------------------------------- CLEAN_TRANSCRIPT

test('a clean transcript may correct the display text but must keep its cue reference', () => {
  const cleaned = draft('CLEAN_TRANSCRIPT', {
    lines: [{ cueId: cues[4].cueId, displayText: 'Từ "logistics" trong slide gốc bị viết sai.' }],
  });
  const result = transcriptPack.validateDraft(cleaned, packContext);
  assert.equal(result.ok, true, 'correcting the display layer is the whole point of this operation');

  const orphan = draft('CLEAN_TRANSCRIPT', { lines: [{ displayText: 'Một câu không gắn với cue nào.' }] });
  const orphanResult = transcriptPack.validateDraft(orphan, packContext);
  assert.equal(orphanResult.ok, false);
  assert.equal(orphanResult.issues[0].code, 'MISSING_CUE_REFERENCE');
});

test('a clean transcript line pointing at a cue that does not exist is blocked', () => {
  const bad = draft('CLEAN_TRANSCRIPT', { lines: [{ cueId: 'cue_9999', displayText: 'x' }] });
  assert.ok(transcriptPack.validateDraft(bad, packContext).issues.some((i) => i.code === 'UNKNOWN_CUE'));
});

// Bản gốc không bao giờ bị bản đã dọn thay thế.
test('cleaning never overwrites the authoritative cue text', () => {
  const cleaned = draft('CLEAN_TRANSCRIPT', {
    lines: [{ cueId: cues[4].cueId, displayText: 'logistics' }],
  });
  transcriptPack.validateDraft(cleaned, packContext);
  assert.ok(transcript.cues[4].rawText.includes('logictics'), 'the source still says what it said');
});

// ---------------------------------------------------------------- QUOTES

test('a quote must be the exact words unless it is marked as a paraphrase', () => {
  const exact = draft('QUOTES', {
    quotes: [{ cueIds: [cues[2].cueId], text: cues[2].rawText }],
  });
  assert.equal(transcriptPack.validateDraft(exact, packContext).ok, true);

  const altered = draft('QUOTES', {
    quotes: [{ cueIds: [cues[2].cueId], text: 'Theo số liệu, 87% khách bỏ giỏ.' }],
  });
  const result = transcriptPack.validateDraft(altered, packContext);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'QUOTE_NOT_VERBATIM');

  const paraphrased = draft('QUOTES', {
    quotes: [{ cueIds: [cues[2].cueId], text: 'Theo số liệu, 87% khách bỏ giỏ.', paraphrase: true }],
  });
  assert.equal(transcriptPack.validateDraft(paraphrased, packContext).ok, true, 'saying it is a paraphrase makes it honest');
});

// ---------------------------------------------------------------- HIGHLIGHTS / CHAPTERS

test('highlights and chapters must point at real cues', () => {
  const highlights = draft('HIGHLIGHTS', {
    highlights: [{ cueIds: [cues[2].cueId], reason: 'Có số liệu cụ thể' }],
  });
  assert.equal(transcriptPack.validateDraft(highlights, packContext).ok, true);

  const chapters = draft('CHAPTERS', {
    chapters: [{ title: 'Vì sao tốc độ quan trọng', startCueId: cues[0].cueId }],
  });
  assert.equal(transcriptPack.validateDraft(chapters, packContext).ok, true);

  const invented = draft('CHAPTERS', { chapters: [{ title: 'Chương ma', startCueId: 'cue_9999' }] });
  assert.ok(transcriptPack.validateDraft(invented, packContext).issues.some((i) => i.code === 'UNKNOWN_CUE'));
});

// Chương phải theo thứ tự thời gian — một mục lục nhảy lung tung là mục lục vô dụng.
test('chapters must run forward in time', () => {
  const backwards = draft('CHAPTERS', {
    chapters: [{ title: 'Sau', startCueId: cues[3].cueId }, { title: 'Trước', startCueId: cues[0].cueId }],
  });
  assert.ok(transcriptPack.validateDraft(backwards, packContext).issues.some((i) => i.code === 'CHAPTERS_OUT_OF_ORDER'));
});

// ---------------------------------------------------------------- REPURPOSE_ARTICLE

test('an article made from a transcript still has to cite its cues', () => {
  const ok = draft('REPURPOSE_ARTICLE', {
    title: 'Cửa sổ kiên nhẫn của khách hàng',
    sections: [{ heading: 'Số liệu', body: '87% khách bỏ giỏ khi chờ quá 3 ngày.', cueIds: [cues[2].cueId] }],
  });
  assert.equal(transcriptPack.validateDraft(ok, packContext).ok, true);

  const uncited = draft('REPURPOSE_ARTICLE', {
    title: 'Cửa sổ kiên nhẫn',
    sections: [{ heading: 'Số liệu', body: '95% khách bỏ giỏ ngay lập tức.' }],
  });
  const result = transcriptPack.validateDraft(uncited, packContext);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'SECTION_WITHOUT_CUE_REFERENCE');
});

// ---------------------------------------------------------------- cổng cuối

// Cổng này chạy lại một lần nữa ngay trước khi lưu. Kiểm hai lần là có chủ ý: giữa lúc
// duyệt và lúc lưu, bản thảo có thể đã đi qua một bước sửa khác.
test('the final gate resolves every cue back to the transcript before persisting', () => {
  const approved = draft('SHORT_CUT', { selections: [shortCutSelection()] });
  assert.equal(transcriptPack.assertSourceFidelity(approved, transcript).ok, true);

  const tampered = draft('SHORT_CUT', {
    selections: [{ ...shortCutSelection(), sourceStartMs: 999 }],
  });
  const blocked = transcriptPack.assertSourceFidelity(tampered, transcript);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.issues[0].code, 'TRANSCRIPT_SOURCE_MISMATCH');
});

test('the final gate refuses a transcript that is not the one the cut came from', () => {
  const approved = draft('SHORT_CUT', { selections: [shortCutSelection()] });
  const other = { ...transcript, sourceId: 's_khac' };
  const result = transcriptPack.assertSourceFidelity(approved, other);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'TRANSCRIPT_SOURCE_MISMATCH');
});

// ================================================================ Nguồn xuất file

// Trước đây exporter nhận thẳng segment dựng từ chuỗi AI trả về: một file .edl có thể sinh
// ra từ timecode model tự nghĩ, và chỉ lộ ra lúc dựng phim.
test('exporting a cut requires cues that resolve back to the transcript', async () => {
  const { RuntimeExportSource, Exporter } = await loadExporter();

  const approved = [{
    cueIds: [cues[2].cueId, cues[0].cueId],
    sourceStartMs: cues[2].startMs,
    sourceEndMs: cues[0].endMs,
    rawTranscript: `${cues[2].rawText}\n${cues[0].rawText}`,
    editorOverlay: 'Số liệu bỏ giỏ',
  }];

  const { segments, sourceCues } = RuntimeExportSource.fromApprovedTranscript(transcript, approved);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].cueIndexes, [3, 1], 'the original cue numbering is kept, not renumbered');
  assert.equal(segments[0].label, 'Số liệu bỏ giỏ');

  // Các hàm xuất cũ vẫn dùng được, chỉ khác là nguồn đã qua cổng kiểm.
  const srt = Exporter.buildSplicedSrt(segments, sourceCues);
  assert.ok(srt.includes(cues[2].rawText), 'the exported cut carries the exact source line');
  assert.ok(Exporter.buildCsv(segments, sourceCues).length > 0);
});

// Thà không xuất còn hơn xuất một bản cắt lệch khỏi video.
test('a tampered timecode or text blocks the export entirely', async () => {
  const { RuntimeExportSource } = await loadExporter();

  const valid = {
    cueIds: [cues[0].cueId],
    sourceStartMs: cues[0].startMs,
    sourceEndMs: cues[0].endMs,
    rawTranscript: cues[0].rawText,
  };

  assert.ok(RuntimeExportSource.fromApprovedTranscript(transcript, [valid]));

  for (const [label, broken] of [
    ['start moved', { ...valid, sourceStartMs: valid.sourceStartMs + 1 }],
    ['end moved', { ...valid, sourceEndMs: valid.sourceEndMs - 1 }],
    ['text tidied', { ...valid, rawTranscript: 'Chào bạn.' }],
    ['unknown cue', { ...valid, cueIds: ['cue_9999'] }],
    ['no cue', { ...valid, cueIds: [] }],
  ]) {
    assert.throws(
      () => RuntimeExportSource.fromApprovedTranscript(transcript, [broken]),
      (e) => e.code === 'TRANSCRIPT_SOURCE_MISMATCH',
      label,
    );
  }
});

// Bản không phải bản cắt được dùng chữ đã dọn, nhưng vẫn phải mang xuất xứ.
test('a writing export uses corrected text but keeps its provenance', async () => {
  const { RuntimeExportSource } = await loadExporter();

  const result = RuntimeExportSource.fromApprovedWriting({
    revisionId: 'revision_9', createdAt: '2026-08-13T00:00:00.000Z',
    payload: { contentId: 'content_1', fields: { title: 'Tiêu đề', body: 'Nội dung đã dọn.' } },
  });
  assert.equal(result.body, 'Nội dung đã dọn.');
  assert.equal(result.provenance.revisionId, 'revision_9');

  assert.throws(() => RuntimeExportSource.fromApprovedWriting(null), (e) => e.code === 'NO_APPROVED_REVISION');
  assert.throws(() => RuntimeExportSource.fromApprovedWriting({ payload: {} }), (e) => e.code === 'NO_APPROVED_REVISION');
});

test('a transcript job is done only when its required evaluations pass', () => {
  const passing = transcriptPack.requiredEvaluators.map((dimension) => ({ dimension, verdict: 'PASS' }));
  assert.equal(transcriptPack.definitionOfDone(draft('SHORT_CUT', {}), passing).done, true);
  assert.equal(transcriptPack.definitionOfDone(draft('SHORT_CUT', {}), []).done, false);
});
