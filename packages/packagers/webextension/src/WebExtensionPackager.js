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
      const jsBundles = deps
        .filter(d => contentScript.js?.includes(d.id))
        .map(d => nullthrows(bundleGraph.getReferencedBundle(d, bundle)));

      contentScript.css = [
        ...new Set(
          (contentScript.css || []).concat(
            jsBundles
              .flatMap(b => bundleGraph.getReferencedBundles(b))
              .filter(b => b.type == 'css')
              .map(relPath),
          ),
        ),
      ];

      war.push({
        matches: contentScript.matches,
        extension_ids: [],
        resources: jsBundles
          .flatMap(b => {
            const children = [];
            const siblings = bundleGraph.getReferencedBundles(b);
            bundleGraph.traverseBundles(child => {
              if (b !== child && !siblings.includes(child)) {
                children.push(child);
              }
            }, b);
            return children;
          })
          .map(relPath),
      });
    }
    manifest.web_accessible_resources = (
      manifest.web_accessible_resources || []
    ).concat(
      manifest.manifest_version == 2
        ? [...new Set(war.flatMap(entry => entry.resources))]
        : war,
    );
    let {contents} = replaceURLReferences({
      bundle,
      bundleGraph,
      contents: JSON.stringify(manifest),
    });
    return {contents};
  },
}): Packager);
