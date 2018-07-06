const Worker = require('../src/worker');

describe('worker', () => {
  it('should not throw when options is null', () => {
    let options = null;
    Worker.init(options);
  });
});
