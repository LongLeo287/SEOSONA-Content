import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, serializeSrt, timeToMs, msToTime, normalizeForMatching, validateTranscriptSelection } from '../runtime/writing/transcript/srt.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(here, 'fixtures/transcript-exact.srt'), 'utf8');
const cues = parseSrt(RAW);

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
