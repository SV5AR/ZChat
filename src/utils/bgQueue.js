// Small background task queue with concurrency limit
// Small background task queue with concurrency limit
// This module exposes a singleton bgQueue factory function for backward
// compatibility. Calling the default export with an optional `concurrency`
// will return the same shared queue instance (first call can set concurrency).

let _instance = null;

function createInstance(concurrency = 5) {
  let running = 0;
  const queue = [];

  function runNext() {
    if (running >= concurrency || queue.length === 0) return;
    const { fn, resolve, reject } = queue.shift();
    running += 1;
    Promise.resolve()
      .then(() => fn())
      .then((res) => {
        running -= 1;
        resolve(res);
        runNext();
      })
      .catch((err) => {
        running -= 1;
        reject(err);
        runNext();
      });
  }

  return {
    push(fn) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        runNext();
      });
    },
    size() {
      return queue.length;
    },
    running() {
      return running;
    },
  };
}

export default function getBgQueue(concurrency = 5) {
  if (!_instance) {
    _instance = createInstance(concurrency);
  }
  return _instance;
}
