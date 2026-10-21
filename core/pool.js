// Limiter konkurensi sederhana untukTCP/HTTP check.
export async function pool(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let index = 0;
  let done = 0;

  async function run() {
    while (true) {
      const i = index++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { error: err?.message || String(err) };
      }
      done++;
      if (onProgress) onProgress(done, items.length, results[i]);
    }
  }

  const count = Math.max(1, Math.min(limit, items.length));
  const workers = [];
  for (let i = 0; i < count; i++) workers.push(run());
  await Promise.all(workers);
  return results;
}
