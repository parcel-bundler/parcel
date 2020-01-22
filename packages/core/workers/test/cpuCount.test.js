import assert from 'assert';
import getCores, {detectRealCores} from '../src/cpuCount';

describe('cpuCount', function() {
  it('Should be able to detect cpu count', () => {
    let cores = detectRealCores();
    assert(cores > 0);
  });

  it('Should be able to detect cpu count', () => {
    let cores = getCores(true);
    assert(cores > 0);
  });
});
