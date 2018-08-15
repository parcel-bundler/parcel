// @flow
'use strict';

class Queue {
  constructor() {
    this.items = [];
  }

  enqueue(...items) {
    for (let item of items) {
      if (!this.items.includes(item)) {
        this.items.push(item);
      }
    }
  }

  empty() {
    let items = this.items.slice();
    this.items.length = 0;
    return items;
  }

  async process(callback) {
    let incomplete = new Set();

    try {
      while (this.items.length) {
        await Promise.all(this.empty().map(async item => {
          incomplete.add(item);
          await callback(item);
          incomplete.remove(item);
        }));
      }
    } catch (err) {
      this.items.push(...incomplete);
      throw err;
    }
  }
}

module.exports = Queue;
