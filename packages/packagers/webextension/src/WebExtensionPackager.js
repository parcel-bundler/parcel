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
    const manifestAssets = assets.filter(a => a.meta.webextEntry === true);

    assert(
      assets.length == 2 && manifestAssets.length == 1,
      'Web extension bundles must contain exactly one manifest asset and one runtime asset',
    );
    const asset = manifestAssets[0];

    const relPath = b =>
      relativeBundlePath(bundle, b, {leadingDotSlash: false});

    const manifest = JSON.parse(await asset.getCode());

    if (manifest.background?.type === 'module') {
      // service workers are built with output format 'global'
      // see: https://github.com/parcel-bundler/parcel/blob/3329469f50de9326c5b02ef0ab1c0ce41393279c/packages/transformers/js/src/JSTransformer.js#L577
      delete manifest.background.type;
    }

    const deps = asset.getDependencies();
    const war = [];
    for (const contentScript of manifest.content_scripts || []) {
      const srcBundles = deps
        .filter(
          d =>
            contentScript.js?.includes(d.id) ||
            contentScript.css?.includes(d.id),
        )
        .map(d => nullthrows(bundleGraph.getReferencedBundle(d, bundle)));

      contentScript.css = [
        ...new Set(
          srcBundles
            .flatMap(b => bundleGraph.getReferencedBundles(b))
            .filter(b => b.type == 'css')
            .map(relPath)
            .concat(contentScript.css || []),
        ),
      ];

      contentScript.js = [
        ...new Set(
          srcBundles
            .flatMap(b => bundleGraph.getReferencedBundles(b))
            .filter(b => b.type == 'js')
            .map(relPath)
            .concat(contentScript.js || []),
        ),
      ];

      const resources = srcBundles
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
        .map(relPath);

      if (resources.length > 0) {
        war.push({
          matches: contentScript.matches.map(match => {
            if (/^(((http|ws)s?)|ftp|\*):\/\//.test(match)) {
              let pathIndex = match.indexOf('/', match.indexOf('://') + 3);
              // Avoids creating additional errors in invalid match URLs
              if (pathIndex == -1) pathIndex = match.length;
              return match.slice(0, pathIndex) + '/*';
            }
            return match;
          }),
          resources,
        });
      }
    }

    const warResult = (manifest.web_accessible_resources || []).concat(
      manifest.manifest_version == 2
        ? [...new Set(war.flatMap(entry => entry.resources))]
        : war,
    );

    if (warResult.length > 0) manifest.web_accessible_resources = warResult;

    let {contents} = replaceURLReferences({
      bundle,
      bundleGraph,
      contents: JSON.stringify(manifest),
    });
    return {contents};
  },
}): Packager);
