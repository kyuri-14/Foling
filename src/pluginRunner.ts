// Runs a plugin exporter's JS inside a module Web Worker.
//
// The worker has no DOM access and no Tauri `invoke` binding, so a plugin
// can transform the HTFL document and return a string, but cannot touch the
// filesystem or the editor directly. (It can still use fetch — exporters that
// need to phone home are the user's call. Only install plugins you trust.)
//
// Contract: the plugin's script is an ES module with a default export
//   `export default function (doc) { return "...output..."; }`
// where `doc` is `{ tree, projectConfig, classFiles }`.

const WORKER_SRC = `
self.onmessage = async (e) => {
  const { code, doc } = e.data;
  try {
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const mod = await import(url);
    URL.revokeObjectURL(url);
    const fn = mod.default || mod.exporter || mod.convert;
    if (typeof fn !== 'function') {
      throw new Error('default export 関数が見つかりません');
    }
    const out = await fn(doc);
    self.postMessage({ ok: true, out: String(out) });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.stack) || err) });
  }
};
`;

export function runExporter(
  code: string,
  doc: unknown,
  timeoutMs = 8000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const workerUrl = URL.createObjectURL(
      new Blob([WORKER_SRC], { type: "text/javascript" })
    );
    const worker = new Worker(workerUrl, { type: "module" });
    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("エクスポータがタイムアウトしました (8秒)"));
    }, timeoutMs);
    worker.onmessage = (e: MessageEvent) => {
      window.clearTimeout(timer);
      cleanup();
      if (e.data?.ok) resolve(e.data.out as string);
      else reject(new Error(e.data?.error ?? "不明なエラー"));
    };
    worker.onerror = (e) => {
      window.clearTimeout(timer);
      cleanup();
      reject(new Error(e.message || "ワーカーエラー"));
    };
    worker.postMessage({ code, doc });
  });
}
