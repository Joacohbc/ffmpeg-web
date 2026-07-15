// Ejecutor de cola con concurrencia acotada. Genérico y sin dependencias.

/**
 * Procesa items con hasta `concurrency` "slots" en paralelo.
 * `worker(item, index, slot)` se invoca por item; el mismo `slot`
 * reutiliza recursos (p.ej. una instancia de ffmpeg) entre items.
 */
export async function runWithConcurrency(items, concurrency, worker) {
  const n = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  const runners = Array.from({ length: n }, (_, slot) =>
    (async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) break;
        await worker(items[index], index, slot);
      }
    })()
  );
  await Promise.all(runners);
}
