export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler) {
      routes.push({ method: String(method).toUpperCase(), pattern, handler });
      return this;
    },
    async dispatch(method, path, context) {
      const normalizedMethod = String(method).toUpperCase();
      for (const route of routes) {
        if (route.method !== normalizedMethod) continue;
        const match = route.pattern.exec(path);
        if (match) return route.handler({ ...context, match });
      }
      return null;
    },
  };
}
