// Drain in-flight work before surfacing a failure; do not start more work after it.
export async function mapConcurrent(items, concurrency, action) {
  const results = new Array(items.length);
  let cursor = 0, failure;
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (!failure && cursor < items.length) {
      const index = cursor++;
      try { results[index] = await action(items[index], index); }
      catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

export function createLimiter(concurrency) {
  let active = 0;
  const queue = [];
  return async action => {
    if (active >= concurrency) await new Promise(resolve => queue.push(resolve));
    else active++;
    try { return await action(); }
    finally {
      if (queue.length) queue.shift()();
      else active--;
    }
  };
}
