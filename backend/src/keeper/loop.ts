// Sequential loop: the next tick starts `intervalMs` after the previous one FINISHED. A tick can take
// minutes (receipt waits, swap polling); setInterval would start another on top of it and act twice
// on the same loan (review Critical #1).
export async function runEvery(
  tick: () => Promise<void>,
  intervalMs: number,
  opts: { times?: number; onError?: (err: unknown) => void } = {},
): Promise<void> {
  const onError = opts.onError ?? ((err) => console.error(new Date().toISOString(), "tick failed:", (err as Error).message));
  for (let i = 0; opts.times === undefined || i < opts.times; i++) {
    try {
      await tick();
    } catch (err) {
      onError(err);
    }
    if (opts.times === undefined || i < opts.times - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
}
