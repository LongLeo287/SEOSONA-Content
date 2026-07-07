// SRT Studio — Gemini adapter (gemini.google.com)
// Lưu ý: UI Gemini có thể hiển thị tiếng Việt -> aria-label có cả 2 ngôn ngữ.
(() => {
  const C = window.__SRT_STUDIO__;
  if (!C) return;

  C.registerProvider({
    name: 'gemini',
    editor: [
      'rich-textarea .ql-editor[contenteditable="true"]',
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ],
    sendButton: [
      'button[aria-label="Send message"]',
      'button[aria-label="Gửi tin nhắn"]',
      'button.send-button',
      '.send-button-container button',
      'button[mattooltip="Send message"]',
    ],
    getAssistantNodes: () => {
      const a = document.querySelectorAll('model-response');
      if (a.length) return a;
      return document.querySelectorAll('.model-response-text');
    },
    isGenerating: () => !!document.querySelector(
      'button[aria-label="Stop response"], button[aria-label="Dừng câu trả lời"], .stop-icon, .streaming'
    ),
    clickStop: () => {
      const b = document.querySelector('button[aria-label="Stop response"], button[aria-label="Dừng câu trả lời"]');
      if (b) b.click();
    },
    extractText: (el) => {
      if (!el) return '';
      const inner = el.querySelector('.model-response-text');
      return (inner || el).innerText || '';
    },
  });
})();
