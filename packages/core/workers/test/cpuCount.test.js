import assert from 'assert';

import getCores, {detectRealCores} from '../src/cpuCount';

describe('cpuCount', function() {
  it('Should be able to detect real cpu count', () => {
    let cores = detectRealCores();
    assert(cores > 0);
  });

  it('getCores should return more than 0', () => {
    let cores = getCores(true);
    assert(cores > 0);
  });
});
