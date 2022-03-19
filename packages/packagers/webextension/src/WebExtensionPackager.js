// @flow strict-local

import assert from 'assert';
import nullthrows from 'nullthrows';
import {Packager} from '@parcel/plugin';
import {replaceURLReferences, relativeBundlePath} from '@parcel/utils';

export default (new Packager({
  async package({bundle, bundleGraph}) {
    let assets = [];
    bundle.traverseAssets(asset => {
      assets.push(asset);
    });

    assert.equal(
      assets.length,
      1,
      'Web extension manifest bundles must only contain one asset',
    );
    const asset = assets[0];
    assert(asset.meta.webextEntry === true);

    const manifest = JSON.parse(await asset.getCode());
    const deps = asset.getDependencies();
    for (const contentScript of manifest.content_scripts || []) {
      const cssBundles = deps
        .filter(d => contentScript.js?.includes(d.id))
        .map(d => bundleGraph.getReferencedBundle(d, bundle))
        .flatMap(b => bundleGraph.getReferencedBundles(nullthrows(b)))
        .filter(b => b.type == 'css');

      contentScript.css = (contentScript.css || []).concat(
        cssBundles.map(b => relativeBundlePath(bundle, b)),
      );
    }
    let {contents} = replaceURLReferences({
      bundle,
      bundleGraph,
      contents: JSON.stringify(manifest),
      relative: false,
    });
    return {contents};
  },
}): Packager);
