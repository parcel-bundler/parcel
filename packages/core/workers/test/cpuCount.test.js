import assert from 'assert';
import os from 'os';

import {getCoreCount} from '../src/cpuCount';

let cpus = os.cpus().length;

describe('cpuCount', function() {
  it('getCoreCount should return more than 0', () => {
    let cores = getCoreCount();
    assert(cores > 0);
  });

  if (cpus > 2) {
    it('Should be able to limit coreCount', () => {
      let allCores = getCoreCount();
      let limitedCores = getCoreCount(1);

      assert(allCores > limitedCores);
      assert.equal(limitedCores, 1);
    });
  }
});
