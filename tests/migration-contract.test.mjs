import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(join(here, '..', relative), 'utf8');

const html = read('extension/sidepanel/index.html');
const app = read('extension/sidepanel/app.js');
const styles = read('extension/sidepanel/styles.css');
const background = read('extension/background.js');
const manifest = JSON.parse(read('extension/manifest.json'));

// Di trú nghĩa là hai đường cùng sống một thời gian. Xóa đường cũ trước khi đường mới được
// nghiệm thu là bắt người dùng đang dùng được phải chờ một thứ chưa chắc chạy.

// ---------------------------------------------------------------- đường mới

test('the side panel gained a runtime backed workspace', () => {
  assert.ok(html.includes('data-view="workspace"'), 'a workspace tab exists');
  assert.ok(html.includes('id="view-workspace"'), 'and its view');
  assert.ok(background.includes('RuntimeClient.create'), 'background holds a runtime client');
  assert.ok(background.includes("importScripts") && background.includes('lib/runtime-client.js'), 'and loads it');
});

test('the workspace surfaces every state the user must be able to tell apart', () => {
  // "Chưa ghép cặp" và "Runtime chưa chạy" cần hai cách xử lý khác nhau; gộp thành "lỗi"
  // sẽ khiến người dùng đi sai hướng.
  assert.ok(app.includes('NOT_PAIRED'), 'not paired');
  assert.ok(app.includes('Runtime chưa chạy'), 'runtime offline');
  assert.ok(app.includes('Chưa có dự án nào'), 'project required');
  assert.ok(app.includes('đang chạy'), 'running');
  assert.ok(app.includes('chờ duyệt'), 'awaiting review');
});

test('current and suggested are shown side by side before anything is applied', () => {
  assert.ok(html.includes('id="rtCurrent"') && html.includes('id="rtSuggested"'));
  assert.ok(styles.includes('.diff-pane'), 'the two panes are laid out together');
  // Chỉ hiện bản mới thì người dùng không có gì để so, và "chấp nhận" thành bấm cho xong.
  assert.ok(html.indexOf('id="rtCurrent"') < html.indexOf('id="rtSuggested"'), 'the original comes first');
});

test('accepting and applying to the page are two separate actions', () => {
  assert.ok(html.includes('id="rtAccept"') && html.includes('id="rtApply"'));
  // Không có đường nào tự ghi vào trang ngay sau khi AI trả kết quả.
  assert.ok(!app.includes('autoApply'), 'nothing applies to the page automatically');
  assert.ok(app.includes("action: 'context:replaceField'"), 'applying goes through the guarded replacement');
});

test('a failed page write never records an applied signal', () => {
  const applyBlock = app.slice(app.indexOf('rt.apply.addEventListener'));
  const failureBranch = applyBlock.indexOf('PAGE_CONTENT_CHANGED');
  const appliedSignal = applyBlock.indexOf('APPLIED_TO_PAGE');
  assert.ok(failureBranch > -1 && appliedSignal > failureBranch, 'the signal is only reached after a successful write');
  assert.ok(applyBlock.includes('return;'), 'a failed write returns early');
});

test('open in studio only ever opens a loopback url', () => {
  const block = app.slice(app.indexOf('rt.openStudio.addEventListener'));
  assert.ok(block.includes('localhost') && block.includes('127.0.0.1'), 'the url is checked before opening');
  assert.ok(block.includes('.test('), 'and the check actually runs against the configured value');
  assert.ok(!block.includes('https://'), 'no remote url is ever constructed');
});

// Side panel là màn hình thứ hai của cùng một kho, không phải kho thứ hai.
test('the side panel keeps only a project preference, not copies of runtime records', () => {
  assert.ok(app.includes('seosonaProjectId'), 'the chosen project is remembered');
  const workspaceBlock = app.slice(app.indexOf('WORKSPACE — companion'));
  for (const leak of ['seosonaProjects', 'cachedProjects', 'localContentStore']) {
    assert.ok(!workspaceBlock.includes(leak), `the panel must not cache ${leak}`);
  }
});

// ---------------------------------------------------------------- đường cũ vẫn còn

test('the legacy SRT studio is still reachable and still wired', () => {
  assert.ok(html.includes('data-view="studio"'), 'the SRT tab survives migration');
  assert.ok(html.includes('id="view-studio"'));
  assert.ok(html.includes('../lib/srt-parser.js'), 'the legacy parser is still loaded');
  assert.ok(html.includes('../lib/exporter.js'), 'and the existing exporters');
});

test('the browser provider path is untouched by the runtime work', () => {
  assert.ok(background.includes('BrowserProviderAdapter.create'), 'the provider adapter still runs');
  for (const legacy of ['srt:runJob', 'srt:jobResult', 'srt:abortJob']) {
    assert.ok(background.includes(legacy), `${legacy} still works during migration`);
  }
});

// Cầu nối provider (lái tab AI) và client Runtime (kho dữ liệu) là HAI đường khác nhau.
// Gộp lại thì một câu trả lời của AI sẽ trở thành bản ghi chính thức mà chưa qua kiểm.
test('the provider bridge and the runtime client stay separate', () => {
  assert.ok(background.includes('runtimeBridge'), 'the provider bridge exists');
  assert.ok(background.includes('runtimeClient'), 'the data client exists');
  assert.notEqual(
    background.indexOf('BrowserProviderAdapter.createRuntimeBridgeClient'),
    background.indexOf('RuntimeClient.create'),
    'they are built from different modules',
  );
});

test('legacy facebook actions remain behind their own message namespace', () => {
  assert.ok(background.includes("msg.action.startsWith('facebook:')"), 'facebook stays namespaced');
  assert.ok(html.includes('../lib/facebook-factory.js'), 'and its libraries are still loaded');
});

// ---------------------------------------------------------------- quyền

// ---------------------------------------------------------------- ranh giới & tính portable

test('the writing core references no legacy facebook identifier', async () => {
  const { auditWritingBoundary } = await import('../scripts/audit/writing-boundary-audit.mjs');
  const result = await auditWritingBoundary({ rootDir: join(here, '..') });
  assert.deepEqual(result.violations, [], 'runtime must not depend on the legacy media workflow');
  assert.ok(result.forbidden.includes('facebook-factory'));
});

test('the legacy facebook code is still present and still loadable', () => {
  // Máy quét ranh giới KHÔNG được thoả mãn bằng cách xóa code người dùng đang dùng.
  for (const file of [
    'extension/lib/facebook-factory.js',
    'extension/lib/facebook-batch.js',
    'extension/lib/facebook-orchestrator.js',
  ]) {
    assert.ok(read(file).length > 0, `${file} stays for compatibility`);
  }
});

// Một cấu hình trỏ vào máy người khác hỏng lặng lẽ: công cụ báo "không tìm thấy" và người
// dùng tưởng sản phẩm hỏng.
test('no committed configuration carries a developer specific path', () => {
  const MACHINE_PATHS = [/C:\\?\/Users\//i, /\/Users\/[a-z0-9._-]+\//i, /\/home\/[a-z0-9._-]+\//i];
  const files = [
    'package.json', '.gitignore', 'extension/manifest.json',
    'runtime/index.mjs', 'runtime/http/server.mjs', 'runtime/studio/app.mjs',
    'extension/background.js', 'extension/lib/runtime-client.js',
    '.claude/launch.json',
  ];
  for (const file of files) {
    const content = read(file);
    for (const pattern of MACHINE_PATHS) {
      assert.ok(!pattern.test(content), `${file} contains a machine specific path`);
    }
  }
});

test('the product does not require an mcp configuration to start', () => {
  const ignore = read('.gitignore');
  assert.ok(ignore.includes('.mcp.json'), 'developer-local integration config is untracked');
  for (const file of ['runtime/index.mjs', 'runtime/http/server.mjs']) {
    assert.ok(!read(file).includes('.mcp.json'), `${file} must not read an mcp config`);
    assert.ok(!read(file).includes('mcpServers'), `${file} must not know about mcp servers`);
  }
});

test('the manifest gained activeTab and nothing broader', () => {
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(!manifest.permissions.includes('<all_urls>'));
  assert.ok(manifest.host_permissions.every((h) => !h.includes('<all_urls>')));
  assert.ok(manifest.host_permissions.some((h) => h.includes('127.0.0.1')), 'loopback stays explicit');
});
