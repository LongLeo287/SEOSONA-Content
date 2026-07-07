// SRT Studio — ChatGPT adapter (chatgpt.com)
// Selector có thể đổi theo phiên bản UI — cập nhật tại đây khi hỏng.
(() => {
  const C = window.__SRT_STUDIO__;
  if (!C) return;

  C.registerProvider({
    name: 'chatgpt',
    editor: [
      '#prompt-textarea',
      'div[contenteditable="true"].ProseMirror',
      'textarea[data-testid="prompt-textarea"]',
    ],
    sendButton: [
      'button[data-testid="send-button"]',
      'button#composer-submit-button',
      'button[aria-label="Send prompt"]',
      'form button[type="submit"]',
    ],
    getAssistantNodes: () => document.querySelectorAll('[data-message-author-role="assistant"]'),
    isGenerating: () => !!document.querySelector(
      'button[data-testid="stop-button"], button[aria-label="Stop streaming"], .result-streaming'
    ),
    clickStop: () => {
      const b = document.querySelector('button[data-testid="stop-button"]');
      if (b) b.click();
    },
    isBlocked: () => {
      const t = document.title.toLowerCase();
      return t.includes('just a moment') || !!document.querySelector('#challenge-form, [id*="cf-chl"]');
    },
    extractText: (el) => {
      if (!el) return '';
      const md = el.querySelector('.markdown');
      return (md || el).innerText || '';
    },
  });
})();
