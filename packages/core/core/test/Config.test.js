import assert from 'assert';
import {serialize, deserialize} from '@parcel/utils/src/serializer';

import Config from '../src/Config';

describe('Config', () => {
  it.only('should serialize and deserialize cleanly', () => {
    let config = new Config({searchPath: 'some-search-path'});
    config.setDevDep('some-dev-dep', '1.0.0');
    config.setResult('some-result');
    config.setResolvedPath('some-resolved-path');
    config.addGlobWatchPattern('some-glob-pattern');
    config.addInvalidatingFile('some-invalidating-file');
    config.addIncludedFile('some-included-file');

    let processedConfig = deserialize(serialize(config));

    assert.equal(processedConfig.searchPath, config.searchPath);
    assert.equal(
      processedConfig.getDevDepVersion('some-dev-dep'),
      config.getDevDepVersion('some-dev-dep')
    );
    assert.equal(processedConfig.resolvedPath, config.resolvedPath);
    assert.deepEqual(
      processedConfig.getInvalidations(),
      config.getInvalidations()
    );
  });
});
