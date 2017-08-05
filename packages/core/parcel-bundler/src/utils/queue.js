class Queue {
  constructor() {
    this.q = new Map;
    this.promises = new Map;
    this.running = 0;
    this.concurrency = 50;
  }

  add(key, fn) {
    if (!this.q.has(key)) {
      let promise = new Promise((resolve, reject) => {
        this.q.set(key, {fn, resolve, reject});
        this.run();
      });

      this.promises.set(key, promise);
      return promise;
    } else {
      return this.promises.get(key);
    }
  }

  run() {
    while (this.running < this.concurrency && this.q.size > 0) {
      this.processNext();
    }
  }

  async processNext() {
    if (this.q.size === 0) {
      return;
    }

    let [key, {fn, resolve, reject}] = this.q.entries().next().value;
    this.q.delete(key);

    this.running++;

    try {
      let res = await fn();
      resolve(res);
    } catch (err) {
      reject(err);
    } finally {
      this.running--;
      this.promises.delete(key);
      this.run();
    }
  }
}

module.exports = Queue;