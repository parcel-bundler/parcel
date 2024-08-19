// @flow

import assert from 'assert';
import path from 'path';
import {bundler, describe, it, outputFS} from '@atlaspack/test-utils';

const config = path.join(
  __dirname,
  './integration/custom-configs/.atlaspackrc-build-metrics',
);

describe.v2('Build Metrics Reporter', () => {
  it('Should dump bundle metrics to atlaspack-metrics.json', async () => {
    let b = bundler(path.join(__dirname, '/integration/commonjs/index.js'), {
      config,
      logLevel: 'info',
    });
    await b.run();

    let projectRoot: string = b._getResolvedAtlaspackOptions().projectRoot;
    let dirContent = await outputFS.readdir(projectRoot);

    assert(
      dirContent.includes('atlaspack-metrics.json'),
      'Should create a atlaspack-metrics.json file',
    );

    let metrics = JSON.parse(
      await outputFS.readFile(
        path.join(projectRoot, 'atlaspack-metrics.json'),
        'utf8',
      ),
    );

    assert(!!metrics.buildTime, 'Should contain buildTime');
    assert(metrics.bundles.length > 0, 'Should contain bundle(s)');
    for (let bundle of metrics.bundles) {
      assert(bundle.filePath, 'Each bundle should have a filePath');
      assert(bundle.size, 'Each bundle should have a size');
      assert(bundle.time, 'Each bundle should have a time');
      assert(
        Array.isArray(bundle.largestAssets),
        'Each bundle should contain a list of largest assets',
      );
      assert(
        bundle.totalAssets,
        'Each bundle should contain the amount of assets',
      );
    }
  });
});
