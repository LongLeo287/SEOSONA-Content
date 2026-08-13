// Router tối giản: khớp method + biểu thức đường dẫn, trả { status, body }.
// Cố ý không mang logic nghiệp vụ — handler chỉ gọi xuống service.

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    routes.push({ method: method.toUpperCase(), pattern, handler });
  }

  function match(method, pathname) {
    for (const route of routes) {
      if (route.method !== method.toUpperCase()) continue;
      const m = route.pattern.exec(pathname);
      if (m) return { handler: route.handler, match: m };
    }
    return null;
  }

  return { add, match };
}
