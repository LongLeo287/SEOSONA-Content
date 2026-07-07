// SRT Studio — cấu hình selector mặc định cho 4 provider (chống vỡ khi web AI đổi UI).
// Mỗi vai trò có NHIỀU selector dự phòng (fallback chain) — thử lần lượt tới khi trúng.
// Người dùng có thể override từng key trong Settings; override lưu ở
// chrome.storage.local.srtSelectorOverrides và được merge đè lên bản mặc định.
// File này load ở CẢ content script lẫn side panel (khai báo global var).

var SRT_SELECTORS_DEFAULT = {
  chatgpt: {
    editor: [
      '#prompt-textarea',
      'div[contenteditable="true"].ProseMirror',
      'textarea[data-testid="prompt-textarea"]',
    ],
    sendButton: [
      'button[data-testid="send-button"]',
      'button#composer-submit-button',
      'button[aria-label*="Send" i]',
      'form button[type="submit"]',
    ],
    assistantNode: ['[data-message-author-role="assistant"]'],
    responseInner: '.markdown',
    insertMode: 'paste',
    generating: 'button[data-testid="stop-button"], button[aria-label="Stop streaming"], .result-streaming',
    stop: 'button[data-testid="stop-button"]',
    blockedSelector: '#challenge-form, [id*="cf-chl"]',
    blockedTitle: ['just a moment'],
    countsUserMessages: false,
    errorPatterns: {
      rate_limit: ['you have used too many', 'rate limit', 'too many requests', 'please try again later', 'usage cap'],
      content_blocked: ['violate our content policy', 'content policy', 'usage policies', "can't help with that"],
    },
  },

  gemini: {
    editor: [
      '.ql-editor[contenteditable="true"]',
      'rich-textarea .ql-editor',
      'div[contenteditable="true"][role="textbox"]',
      'div[aria-label*="prompt" i][contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    sendButton: [
      'button[aria-label*="Send" i]',
      'button[aria-label*="Gửi" i]',
      'button.send-button',
      '.send-button-container button',
      'button[mattooltip*="Send" i]',
      'button[mattooltip*="Gửi" i]',
    ],
    assistantNode: ['model-response', 'message-content', '.model-response-text'],
    responseInner: '.markdown-main-panel, .markdown, message-content',
    generating: '.markdown[aria-busy="true"], message-content[aria-busy="true"], mat-progress-bar:not([hidden]), button[aria-label*="Stop" i], button[aria-label*="Dừng" i]',
    stop: 'button[aria-label*="Stop" i], button[aria-label*="Dừng" i]',
    blockedSelector: null,
    blockedTitle: [],
    countsUserMessages: false,
    insertMode: 'gemini',
    errorPatterns: {
      rate_limit: ['you\'ve reached your limit', 'try again later', 'quota'],
    },
  },

  grok: {
    editor: [
      'textarea[aria-label*="Grok"]',
      'div[contenteditable="true"][role="textbox"]',
      'form textarea',
      'div[contenteditable="true"]',
      'textarea',
    ],
    sendButton: [
      'button[aria-label="Submit"]',
      'button[type="submit"]',
      'button[aria-label*="Send"]',
      'form button:last-of-type',
    ],
    assistantNode: ['[class*="message-bubble"]', '[data-testid*="message"]', '.message'],
    responseInner: null,
    generating: 'button[aria-label="Stop"], button[aria-label*="Stop"], [class*="loading"], [class*="generating"]',
    stop: 'button[aria-label="Stop"], button[aria-label*="Stop"]',
    blockedSelector: '[id*="cf-chl"]',
    blockedTitle: ['just a moment'],
    countsUserMessages: true,
    errorPatterns: {
      rate_limit: ['rate limit', 'too many requests', 'try again later'],
    },
  },

  claude: {
    editor: [
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][aria-label]',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"]',
    ],
    sendButton: [
      'button[aria-label="Send message"]',
      'button[aria-label="Send Message"]',
      'button[type="submit"]',
    ],
    assistantNode: ['div[data-is-streaming]', '.font-claude-message', '[data-testid="assistant-message"]'],
    responseInner: '.font-claude-message',
    generating: 'div[data-is-streaming="true"], button[aria-label="Stop response"]',
    stop: 'button[aria-label="Stop response"]',
    blockedSelector: null,
    blockedTitle: [],
    countsUserMessages: false,
    errorPatterns: {
      rate_limit: ['message limit', 'reached your limit', 'try again later', 'usage limit'],
    },
  },
};

// Danh sách key selector cho phép override (dùng cho UI Settings)
var SRT_SELECTOR_KEYS = ['editor', 'sendButton', 'assistantNode', 'responseInner', 'generating', 'stop', 'blockedSelector'];
var SRT_ARRAY_KEYS = ['editor', 'sendButton', 'assistantNode'];

// Merge default + override cho 1 provider -> config đầy đủ
function srtBuildProviderConfig(name, overrides) {
  var base = SRT_SELECTORS_DEFAULT[name] || {};
  var ov = (overrides && overrides[name]) || {};
  var out = {};
  for (var k in base) out[k] = base[k];
  SRT_SELECTOR_KEYS.forEach(function (k) {
    if (ov[k] == null) return;
    if (SRT_ARRAY_KEYS.indexOf(k) >= 0) {
      if (Array.isArray(ov[k]) && ov[k].length) out[k] = ov[k];
    } else if (ov[k]) {
      out[k] = ov[k];
    }
  });
  return out;
}

// Cho phép truy cập ở worker/module không có var hoisting chung
if (typeof window !== 'undefined') {
  window.SRT_SELECTORS_DEFAULT = SRT_SELECTORS_DEFAULT;
  window.SRT_SELECTOR_KEYS = SRT_SELECTOR_KEYS;
  window.SRT_ARRAY_KEYS = SRT_ARRAY_KEYS;
  window.srtBuildProviderConfig = srtBuildProviderConfig;
}
