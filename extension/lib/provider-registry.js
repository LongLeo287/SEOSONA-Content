(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BrowserProviderRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ORDER = ['chatgpt-web', 'gemini-web', 'grok-web', 'claude-web'];
  const RECORDS = {
    'chatgpt-web': { providerId: 'chatgpt-web', pageKey: 'chatgpt', label: 'ChatGPT', baseUrl: 'https://chatgpt.com/', match: ['*://chatgpt.com/*'], scripts: ['content/common.js', 'content/chatgpt.js'] },
    'gemini-web': { providerId: 'gemini-web', pageKey: 'gemini', label: 'Gemini', baseUrl: 'https://gemini.google.com/app', match: ['*://gemini.google.com/*'], scripts: ['content/common.js', 'content/gemini.js'] },
    'grok-web': { providerId: 'grok-web', pageKey: 'grok', label: 'Grok', baseUrl: 'https://grok.com/', match: ['https://grok.com/*', 'https://*.grok.com/*'], scripts: ['content/common.js', 'content/grok.js'] },
    'claude-web': { providerId: 'claude-web', pageKey: 'claude', label: 'Claude', baseUrl: 'https://claude.ai/new', match: ['https://claude.ai/*'], scripts: ['content/common.js', 'content/claude.js'] },
  };
  function copy(value) { return value ? JSON.parse(JSON.stringify(value)) : null; }
  function get(providerId) { return copy(RECORDS[providerId] || null); }
  function list() { return ORDER.map((id) => get(id)); }
  function fromPageKey(pageKey) { return list().find((record) => record.pageKey === pageKey) || null; }
  return { get, list, fromPageKey };
});
