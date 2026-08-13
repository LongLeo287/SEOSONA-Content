import { resolve } from 'node:path';
import { createRuntimeServer } from './http/server.mjs';

// Điểm khởi chạy Local Runtime.
//
// Chỉ bind 127.0.0.1 — Runtime KHÔNG BAO GIỜ được lắng nghe trên giao diện công khai.
// Token là bắt buộc và tối thiểu 32 ký tự: không có chế độ "chạy không cần xác thực",
// vì localhost không phải vùng tin cậy (tiến trình khác và trang web đang mở đều gọi được).

const HOST = '127.0.0.1';
const DEFAULTS = { root: './.seosona-content', port: 43118 };

function readConfig(env = process.env) {
  const token = env.SEOSONA_CONTENT_RUNTIME_TOKEN;
  if (!token || token.length < 32) {
    throw new Error('SEOSONA_CONTENT_RUNTIME_TOKEN is required and must be at least 32 characters.');
  }
  const extensionId = env.SEOSONA_CONTENT_EXTENSION_ID || '';
  return {
    rootDir: resolve(env.SEOSONA_CONTENT_RUNTIME_ROOT || DEFAULTS.root),
    port: Number(env.SEOSONA_CONTENT_RUNTIME_PORT || DEFAULTS.port),
    token,
    // Không có extension id thì cầu nối extension đơn giản là TẮT, chứ không nới lỏng origin.
    extensionOrigin: extensionId ? `chrome-extension://${extensionId}` : null,
  };
}

export function startRuntime(env = process.env) {
  const config = readConfig(env);
  const server = createRuntimeServer(config);

  return new Promise((resolveStart) => {
    server.listen(config.port, HOST, () => {
      const { port } = server.address();
      // Ghi ra stderr để stdout còn dành cho dữ liệu nếu sau này cần pipe.
      process.stderr.write(
        `SEOSONA Content Runtime listening on http://${HOST}:${port} · root=${config.rootDir} · extensionBridge=${config.extensionOrigin ? 'on' : 'off'}\n`,
      );
      resolveStart(server);
    });
  });
}

// Chỉ tự chạy khi được gọi trực tiếp, để test import được mà không mở cổng.
const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isDirectRun) {
  const server = await startRuntime();
  const shutdown = (signal) => {
    process.stderr.write(`\nReceived ${signal}, closing runtime…\n`);
    server.close(() => process.exit(0));
    // Không để treo vô hạn nếu còn kết nối mở.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
