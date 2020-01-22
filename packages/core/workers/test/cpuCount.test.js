import assert from 'assert';
import os from 'os';

import getCores, {detectRealCores} from '../src/cpuCount';

describe('cpuCount', function() {
  it('Should be able to detect cpu count', () => {
    // I have no clue how to detect cpu cores on windows
    if (os.platform() === 'windows') return;

    let cores = detectRealCores();
    assert(cores > 0);
  });

  it('Should be able to detect cpu count', () => {
    let cores = getCores(true);
    assert(cores > 0);
  });
});
