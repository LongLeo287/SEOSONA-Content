// SRT Studio — Grok adapter (grok.com)
// Grok render cả bubble user lẫn assistant trong cùng danh sách
// -> countsUserMessages: true để engine chờ đủ 2 message mới (user + assistant).
(() => {
  const C = window.__SRT_STUDIO__;
  if (!C) return;

  C.registerProvider({
    name: 'grok',
    countsUserMessages: true,
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
    getAssistantNodes: () => {
      const a = document.querySelectorAll('[class*="message-bubble"]');
      if (a.length) return a;
      return document.querySelectorAll('[data-testid*="message"], .message');
    },
    isGenerating: () => !!document.querySelector(
      'button[aria-label="Stop"], button[aria-label*="Stop"], [class*="loading"], [class*="generating"]'
    ),
    clickStop: () => {
      const b = document.querySelector('button[aria-label="Stop"], button[aria-label*="Stop"]');
      if (b) b.click();
    },
    isBlocked: () => {
      const t = document.title.toLowerCase();
      return t.includes('just a moment') || !!document.querySelector('[id*="cf-chl"]');
    },
    extractText: (el) => (el ? el.innerText || '' : ''),
  });
})();
