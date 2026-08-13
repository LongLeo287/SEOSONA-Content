/* SEOSONA Content — danh mục provider trình duyệt (không phụ thuộc tên gọi SRT). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrowserProviderRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Mỗi provider có HAI tên:
  //   providerId ('chatgpt-web') — tên chung, dùng ở Runtime/Gateway, không dính tính năng SRT;
  //   page       ('chatgpt')     — tên cũ, đang nằm khắp side panel, content script và storage.
  // Giữ cả hai và tra được theo cả hai để di trú không phải đổi mọi thứ cùng một lúc.
  //
  // supportsModelSwitch chỉ được đặt true khi extension THẬT SỰ bấm đổi được model trên trang.
  // Bày ô chọn model cho một hãng không đổi được là nói dối người dùng: họ tưởng đã đổi,
  // thực tế vẫn chạy model cũ. (Có test khóa cờ này với MODEL_CATALOG để hai bên không trôi.)
  const PROVIDERS = [
    {
      providerId: 'chatgpt-web',
      page: 'chatgpt',
      label: 'ChatGPT',
      baseUrl: 'https://chatgpt.com/',
      match: ['*://chatgpt.com/*'],
      scripts: ['content/common.js', 'content/chatgpt.js'],
      supportsModelSwitch: true,
    },
    {
      providerId: 'gemini-web',
      page: 'gemini',
      label: 'Gemini',
      baseUrl: 'https://gemini.google.com/app',
      match: ['*://gemini.google.com/*'],
      scripts: ['content/common.js', 'content/gemini.js'],
      supportsModelSwitch: true,
    },
    {
      providerId: 'grok-web',
      page: 'grok',
      label: 'Grok',
      baseUrl: 'https://grok.com/',
      match: ['https://grok.com/*', 'https://*.grok.com/*'],
      scripts: ['content/common.js', 'content/grok.js'],
      supportsModelSwitch: false,
    },
    {
      providerId: 'claude-web',
      page: 'claude',
      label: 'Claude',
      baseUrl: 'https://claude.ai/new',
      match: ['https://claude.ai/*'],
      scripts: ['content/common.js', 'content/claude.js'],
      supportsModelSwitch: true,
    },
  ];

  const byId = new Map();
  for (const provider of PROVIDERS) {
    byId.set(provider.providerId, provider);
    byId.set(provider.page, provider);
  }

  function get(idOrPage) {
    return byId.get(String(idOrPage || '')) || null;
  }

  return {
    get,
    list: () => PROVIDERS.slice(),
    pageOf: (idOrPage) => (get(idOrPage) || {}).page || null,
    providerIdOf: (idOrPage) => (get(idOrPage) || {}).providerId || null,
    // Dạng { page: label } — đúng hình dạng side panel đang dùng.
    labels: () => PROVIDERS.reduce((acc, p) => { acc[p.page] = p.label; return acc; }, {}),
  };
});
