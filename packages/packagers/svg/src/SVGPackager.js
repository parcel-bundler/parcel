// @flow

import type {Bundle, BundleGraph, NamedBundle} from '@parcel/types';
import assert from 'assert';
import {Packager} from '@parcel/plugin';
import posthtml from 'posthtml';
import {
  blobToString,
  replaceInlineReferences,
  replaceURLReferences,
} from '@parcel/utils';

export default (new Packager({
  async package({bundle, bundleGraph, getInlineBundleContents}) {
    const assets = [];
    bundle.traverseAssets(asset => {
      assets.push(asset);
    });

    assert.strictEqual(
      assets.length,
      1,
      'SVG bundles must only contain one asset',
    );

    const asset = assets[0];
    const code = await asset.getCode();
    const options = {
      directives: [
        {
          name: /^\?/,
          start: '<',
          end: '>',
        },
      ],
      xmlMode: true,
    };

    let {html: svg} = await posthtml([
      tree =>
        replaceInlineAssetContent(bundleGraph, getInlineBundleContents, tree),
    ]).process(code, options);

    const {contents, map} = replaceURLReferences({
      bundle,
      bundleGraph,
      contents: svg,
      relative: false,
    });

    return replaceInlineReferences({
      bundle,
      bundleGraph,
      contents,
      getInlineBundleContents,
      getInlineReplacement: (dep, inlineType, contents) => ({
        from: dep.id,
        to: contents.replace(/"/g, '&quot;').trim(),
      }),
      map,
    });
  },
}): Packager);

async function replaceInlineAssetContent(
  bundleGraph: BundleGraph<NamedBundle>,
  getInlineBundleContents,
  tree,
) {
  const inlineNodes = [];
  tree.walk(node => {
    if (node.attrs && node.attrs['data-parcel-key']) {
      inlineNodes.push(node);
    }
    return node;
  });

  for (const node of inlineNodes) {
    const newContent = await getAssetContent(
      bundleGraph,
      getInlineBundleContents,
      node.attrs['data-parcel-key'],
    );

    if (newContent === null) {
      continue;
    }

    node.content = await blobToString(newContent.contents);

    // Wrap scripts and styles with CDATA if needed to ensure characters are not interpreted as XML
    if (node.tag === 'script' || node.tag === 'style') {
      if (node.content.includes('<') || node.content.includes('&')) {
        node.content = node.content.replace(/]]>/g, ']\\]>');
        node.content = `<![CDATA[\n${node.content}\n]]>`;
      }
    }

    // remove attr from output
    delete node.attrs['data-parcel-key'];
  }

  return tree;
}

async function getAssetContent(
  bundleGraph: BundleGraph<NamedBundle>,
  getInlineBundleContents,
  assetId,
) {
  let inlineBundle: ?Bundle;
  bundleGraph.traverseBundles((bundle, context, {stop}) => {
    const entryAssets = bundle.getEntryAssets();
    if (entryAssets.some(a => a.uniqueKey === assetId)) {
      inlineBundle = bundle;
      stop();
    }
  });

  if (!inlineBundle) {
    return null;
  }

  const bundleResult = await getInlineBundleContents(inlineBundle, bundleGraph);

  return {bundle: inlineBundle, contents: bundleResult.contents};
}
