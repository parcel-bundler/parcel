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

    const relPath = b =>
      relativeBundlePath(bundle, b, {leadingDotSlash: false});

    const manifest = JSON.parse(await asset.getCode());
    const deps = asset.getDependencies();
    const war = [];
    for (const contentScript of manifest.content_scripts || []) {
      const referencedBundles = deps
        .filter(d => contentScript.js?.includes(d.id))
        .map(d => nullthrows(bundleGraph.getReferencedBundle(d, bundle)));

      contentScript.css = [
        ...new Set(
          (contentScript.css || []).concat(
            referencedBundles
              .flatMap(b => bundleGraph.getReferencedBundles(b))
              .filter(b => b.type == 'css')
              .map(relPath),
          ),
        ),
      ];

      war.push({
        matches: contentScript.matches,
        extension_ids: [],
        resources: referencedBundles
          .flatMap(b => bundleGraph.getChildBundles(b))
          .map(relPath),
      });
    }
    manifest.web_accessible_resources = (
      manifest.web_accessible_resources || []
    ).concat(war);
    let {contents} = replaceURLReferences({
      bundle,
      bundleGraph,
      contents: JSON.stringify(manifest),
    });
    return {contents};
  },
}): Packager);
