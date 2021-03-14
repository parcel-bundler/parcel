// @flow strict-local
import type {Bundle, BundleGraph, NamedBundle} from '@parcel/types';

import assert from 'assert';
import {Readable} from 'stream';
import {Packager} from '@parcel/plugin';
import {setDifference} from '@parcel/utils';
import posthtml from 'posthtml';
import {
  bufferStream,
  replaceInlineReferences,
  replaceURLReferences,
  urlJoin,
} from '@parcel/utils';
import nullthrows from 'nullthrows';

// https://www.w3.org/TR/html5/dom.html#metadata-content-2
const metadataContent = new Set([
  'base',
  'link',
  'meta',
  'noscript',
  // 'script', // retain script order (somewhat)
  'style',
  'template',
  'title',
]);

export default (new Packager({
  async package({bundle, bundleGraph, getInlineBundleContents}) {
    let assets = [];
    bundle.traverseAssets(asset => {
      assets.push(asset);
    });

    assert.equal(assets.length, 1, 'HTML bundles must only contain one asset');

    let asset = assets[0];
    let code = await asset.getCode();

    // Add bundles in the same bundle group that are not inline. For example, if two inline
    // bundles refer to the same library that is extracted into a shared bundle.
    let referencedBundles = [
      ...setDifference(
        new Set(bundleGraph.getReferencedBundles(bundle)),
        new Set(bundleGraph.getReferencedBundles(bundle, {recursive: false})),
      ),
    ].filter(b => !b.isInline);
    let posthtmlConfig = await asset.getConfig(
      ['.posthtmlrc', '.posthtmlrc.js', 'posthtml.config.js'],
      {
        packageKey: 'posthtml',
      },
    );
    let renderConfig = posthtmlConfig?.render;

    let {html} = await posthtml([
      insertBundleReferences.bind(this, referencedBundles),
      replaceInlineAssetContent.bind(
        this,
        bundleGraph,
        getInlineBundleContents,
      ),
    ]).process(code, renderConfig);

    let {contents, map} = replaceURLReferences({
      bundle,
      bundleGraph,
      contents: html,
      relative: false,
    });

    return replaceInlineReferences({
      bundle,
      bundleGraph,
      contents,
      getInlineBundleContents,
      getInlineReplacement: (dep, inlineType, contents) => ({
        from: dep.id,
        to: contents,
      }),
      map,
    });
  },
}): Packager);

async function getAssetContent(
  bundleGraph: BundleGraph<NamedBundle>,
  getInlineBundleContents,
  assetId,
) {
  let inlineBundle: ?Bundle;
  bundleGraph.traverseBundles((bundle, context, {stop}) => {
    let entryAssets = bundle.getEntryAssets();
    if (entryAssets.some(a => a.uniqueKey === assetId)) {
      inlineBundle = bundle;
      stop();
    }
  });

  if (inlineBundle) {
    const bundleResult = await getInlineBundleContents(
      inlineBundle,
      bundleGraph,
    );

    return {bundle: inlineBundle, contents: bundleResult.contents};
  }

  return null;
}

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

  for (let node of inlineNodes) {
    let newContent = await getAssetContent(
      bundleGraph,
      getInlineBundleContents,
      node.attrs['data-parcel-key'],
    );

    if (newContent != null) {
      let {contents, bundle} = newContent;
      node.content = (contents instanceof Readable
        ? await bufferStream(contents)
        : contents
      ).toString();

      if (nullthrows(bundle).env.outputFormat === 'esmodule') {
        node.attrs.type = 'module';
      }

      // remove attr from output
      delete node.attrs['data-parcel-key'];
    }
  }

  return tree;
}

function insertBundleReferences(siblingBundles, tree) {
  const bundles = [];

  for (let bundle of siblingBundles) {
    if (bundle.type === 'css') {
      bundles.push({
        tag: 'link',
        attrs: {
          rel: 'stylesheet',
          href: urlJoin(
            nullthrows(bundle.target).publicUrl,
            nullthrows(bundle.name),
          ),
        },
      });
    } else if (bundle.type === 'js') {
      bundles.push({
        tag: 'script',
        attrs: {
          type: bundle.env.outputFormat === 'esmodule' ? 'module' : undefined,
          src: urlJoin(
            nullthrows(bundle.target).publicUrl,
            nullthrows(bundle.name),
          ),
        },
      });
    }
  }

  addBundlesToTree(bundles, tree);
}

function addBundlesToTree(bundles, tree) {
  const main = find(tree, 'head') || find(tree, 'html');
  const content = main ? main.content || (main.content = []) : tree;
  const index = findBundleInsertIndex(content);

  content.splice(index, 0, ...bundles);
}

function find(tree, tag) {
  let res;
  tree.match({tag}, node => {
    res = node;
    return node;
  });

  return res;
}

function findBundleInsertIndex(content) {
  // HTML document order (https://html.spec.whatwg.org/multipage/syntax.html#writing)
  //   - Any number of comments and ASCII whitespace.
  //   - A DOCTYPE.
  //   - Any number of comments and ASCII whitespace.
  //   - The document element, in the form of an html element.
  //   - Any number of comments and ASCII whitespace.
  //
  // -> Insert before first non-metadata (or script) element; if none was found, after the doctype

  let doctypeIndex;
  for (let index = 0; index < content.length; index++) {
    const node = content[index];
    if (node && node.tag && !metadataContent.has(node.tag)) {
      return index;
    }
    if (
      typeof node === 'string' &&
      node.toLowerCase().startsWith('<!doctype')
    ) {
      doctypeIndex = index;
    }
  }

  return doctypeIndex ? doctypeIndex + 1 : 0;
}
