// @flow
'use strict';

const BundleBuilder = require('../src/BundleBuilder');
const AssetGraphBuilder = require('../src/AssetGraphBuilder');
const config = require('@parcel/config-default');
const path = require('path');
const assert = require('assert');
const prettyFormat = require('pretty-format');

describe('BundleBuilder', () => {
  it('should work', async () => {
    let bundleBuilder = new BundleBuilder();
    let graphBuilder = new AssetGraphBuilder(config, {});
    let graph = await graphBuilder.build(__dirname, ['./fixtures/bundle.js']);
    let bundleManifest = await bundleBuilder.build(graph, { destFolder: path.join(__dirname, 'dist') });
    console.log(prettyFormat(bundleManifest));
  });
});
