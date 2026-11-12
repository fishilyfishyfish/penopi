// Engine workers. Every game runs its engine in a Web Worker so the page never freezes.
// Protocol (each game's worker.js speaks it): the page posts {id, ...request};
// the worker answers {id, result} or {id, error}, and may post {id, progress} on the way.
//
// call(request, {timeout}) returns a promise. When a call runs past its timeout the worker is killed
// (a WASM call can't be interrupted any other way), the promise rejects with a TimeoutError,
// and the next call starts a fresh worker. restart() does the same on purpose (new game mid-think).

export class TimeoutError extends Error {}

export function workerClient(url, { type = 'module', onProgress = () => {}, onFresh = () => {} } = {}) {
  let worker = null, nextId = 1;
  const pending = new Map();
  function spawn() {
    worker = new Worker(url, { type });
    worker.onmessage = (e) => {
      const { id, progress, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (progress !== undefined) { onProgress(progress); return; }
      pending.delete(id);
      clearTimeout(p.timer);
      if (error) p.reject(new Error(error));
      else p.resolve(e.data.result);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      kill(new Error(e.message || '엔진을 불러오지 못했어'));
    };
    onFresh(); // a fresh worker has a fresh engine: whoever keeps state there must send it again
  }
  function kill(err) {
    if (worker) worker.terminate();
    worker = null;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
    pending.clear();
  }
  function call(req, { timeout = 0, transfer = [] } = {}) {
    if (!worker) spawn();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const p = { resolve, reject, timer: 0 };
      if (timeout) p.timer = setTimeout(() => kill(new TimeoutError('시간 초과')), timeout);
      pending.set(id, p);
      worker.postMessage({ id, ...req }, transfer);
    });
  }
  return { call, restart: () => kill(new Error('다시 시작')), get alive() { return !!worker; } };
}

// How many helper workers a parallel search may use: spare cores, but few on a phone.
export function spareCores(max) {
  const n = (navigator.hardwareConcurrency || 2) - 1;
  return Math.max(1, Math.min(max, n));
}
