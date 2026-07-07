// SRT Studio — ChatGPT adapter. Selector nằm trong lib/selectors-default.js
// (override được trong Settings). File này chỉ đăng ký theo tên.
(() => {
  const C = window.__SRT_STUDIO__;
  if (C) C.registerProvider('chatgpt');
})();
