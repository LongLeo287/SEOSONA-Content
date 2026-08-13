// Bộ dựng DOM tí hon cho Studio.
//
// KHÔNG có đường nào đặt HTML thô ở đây, và đó là chủ ý. Studio hiển thị chữ lấy từ trang web
// của người khác, từ file transcript, từ mô tả sản phẩm — toàn những nguồn không kiểm soát
// được. Một chỗ dùng innerHTML là một chỗ trang nguồn viết được HTML vào Studio.
//
// Mọi chữ đều đi qua textContent.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export const card = (children) => el('div', { class: 'card' }, children);
export const muted = (text) => el('p', { class: 'muted', text });
export const empty = (text) => el('p', { class: 'empty', text });

export function table(headers, rows) {
  return el('table', {}, [
    el('thead', {}, el('tr', {}, headers.map((h) => el('th', { text: h })))),
    el('tbody', {}, rows.map((cells) => el('tr', {}, cells.map((c) => (
      typeof c === 'string' || typeof c === 'number' ? el('td', { text: String(c) }) : el('td', {}, c)
    ))))),
  ]);
}

export function field(label, input) {
  return el('label', {}, [el('span', { text: label }), input]);
}

export function notice(kind, text) {
  return el('div', { class: `notice ${kind}`, text });
}

/** Chữ nguyên văn: hiển thị y hệt nguồn, kể cả khoảng trắng và lỗi chính tả. */
export const verbatim = (text) => el('div', { class: 'verbatim', text: String(text ?? '') });
