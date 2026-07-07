// SRT Studio — Claude adapter (claude.ai)
(() => {
  const C = window.__SRT_STUDIO__;
  if (!C) return;

  C.registerProvider({
    name: 'claude',
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
    getAssistantNodes: () => {
      // Mỗi lượt trả lời của Claude nằm trong wrapper có attr data-is-streaming
      const a = document.querySelectorAll('div[data-is-streaming]');
      if (a.length) return a;
      return document.querySelectorAll('.font-claude-message, [data-testid="assistant-message"]');
    },
    isGenerating: () => !!document.querySelector(
      'div[data-is-streaming="true"], button[aria-label="Stop response"]'
    ),
    clickStop: () => {
      const b = document.querySelector('button[aria-label="Stop response"]');
      if (b) b.click();
    },
    extractText: (el) => {
      if (!el) return '';
      const inner = el.querySelector('.font-claude-message');
      return (inner || el).innerText || '';
    },
  });
})();
