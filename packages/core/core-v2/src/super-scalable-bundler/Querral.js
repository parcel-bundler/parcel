// que + corall, get it?
export default class Querral {
  constructor(queues) {
    this.queues = queues;
  }

  allDone() {
    let { queues } = this;
    
    return Promise.all(queues.map(q => q.onIdle())).then(() => {
      let unfinishedCounts = queues.map(q => (q.size + q.pending));
      let anyUndone = unfinishedCounts.some(count => (count > 0))

      if (anyUndone) {
        return this.allDone();
      }

      console.log('all queues finished')
    })
  }
}
