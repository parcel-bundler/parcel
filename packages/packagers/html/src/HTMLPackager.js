// @flow strict-local

import assert from 'assert';
import {Packager} from '@parcel/plugin';
import posthtml from 'posthtml';
import {urlJoin} from '@parcel/utils';
import nullthrows from 'nullthrows';

// https://www.w3.org/TR/html5/dom.html#metadata-content-2
const metadataContent = new Set([
  'base',
  'link',
  'meta',
  'noscript',
  'script',
  'style',
  'template',
  'title'
]);

// fake implementation, of what will be passed from packageRunner
const mockGetBundleResult = async (bundle, bundleGraph) => {
  const asset = bundle.getMainEntry();
  let [contents, map] = await Promise.all([asset.getCode(), asset.getMap()]);

  return {
    contents,
    map
  };
};

export default new Packager({
  async package({bundle, bundleGraph}) {
    let assets = [];
    bundle.traverseAssets(asset => {
      assets.push(asset);
    });

    assert.equal(assets.length, 1, 'HTML bundles must only contain one asset');

    let asset = assets[0];
    let code = await asset.getCode();

    // Insert references to sibling bundles. For example, a <script> tag in the original HTML
    // may import CSS files. This will result in a sibling bundle in the same bundle group as the
    // JS. This will be inserted as a <link> element into the HTML here.
    let bundleGroups = bundleGraph.getBundleGroupsReferencedByBundle(bundle);
    let bundles = bundleGroups.reduce((p, {bundleGroup}) => {
      let bundles = bundleGraph
        .getBundlesInBundleGroup(bundleGroup)
        .filter(
          bundle =>
            !bundle
              .getEntryAssets()
              .some(asset => asset.id === bundleGroup.entryAssetId)
        );
      return p.concat(bundles);
    }, []);

    let {html} = await posthtml([
      insertBundleReferences.bind(this, bundles),
      replaceInlineAssetContent.bind(
        this,
        getAssetContent.bind(this, bundleGraph, mockGetBundleResult)
      )
    ]).process(code);

    return {contents: html};
  }
});

async function getAssetContent(bundleGraph, getBundleResult, assetId) {
  let inlineBundle: ?Bundle;
  bundleGraph.traverseBundles((bundle, context, {stop}) => {
    if (bundle.id.includes(assetId)) {
      inlineBundle = bundle;
      stop();
    }
  });

  if (inlineBundle) {
    const bundleResult = await getBundleResult(inlineBundle, bundleGraph);

    return bundleResult.contents;
  }

  return `unable to find bundle for id - ${assetId}`;
}

async function replaceInlineAssetContent(getAssetContent, tree) {
  const inlineNodes = [];
  tree.walk(node => {
    if (node.attrs && node.attrs['data-parcelId']) {
      inlineNodes.push(node);
    }
    return node;
  });

  for (let node of inlineNodes) {
    node.content = await getAssetContent(node.attrs['data-parcelId']);
    // remove attr from output
    delete node.attrs['data-parcelId'];
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
            nullthrows(bundle.target).publicUrl ?? '/',
            nullthrows(bundle.name)
          )
        }
      });
    } else if (bundle.type === 'js') {
      bundles.push({
        tag: 'script',
        attrs: {
          src: urlJoin(
            nullthrows(bundle.target).publicUrl ?? '/',
            nullthrows(bundle.name)
          )
        }
      });
    }
  }

  addBundlesToTree(bundles, tree);
}

function addBundlesToTree(bundles, tree) {
  const head = find(tree, 'head');
  if (head) {
    const content = head.content || (head.content = []);
    content.push(...bundles);
    return;
  }

  const html = find(tree, 'html');
  const content = html ? html.content || (html.content = []) : tree;
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
  for (let index = 0; index < content.length; index++) {
    const node = content[index];
    if (node && node.tag && !metadataContent.has(node.tag)) {
      return index;
    }
  }

  return 0;
}
