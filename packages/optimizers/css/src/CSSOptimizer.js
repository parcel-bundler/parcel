// @flow strict-local

import SourceMap from '@parcel/source-map';
import {Optimizer} from '@parcel/plugin';
// $FlowFixMe
import {transform} from '@parcel/css';
import {blobToBuffer} from '@parcel/utils';
import browserslist from 'browserslist';

export default (new Optimizer({
  async optimize({
    bundle,
    contents: prevContents,
    getSourceMapReference,
    map: prevMap,
    options,
  }) {
    if (!bundle.env.shouldOptimize) {
      return {contents: prevContents, map: prevMap};
    }

    let targets = getTargets(bundle.env.engines.browsers);
    let code = await blobToBuffer(prevContents);
    let result = transform({
      filename: bundle.name,
      code,
      minify: true,
      source_map: !!bundle.env.sourceMap,
      targets,
    });

    let map;
    if (result.map != null) {
      map = new SourceMap(options.projectRoot);
      map.addVLQMap(JSON.parse(result.map));
    }

    let contents = result.code;
    if (bundle.env.sourceMap) {
      let reference = await getSourceMapReference(map);
      if (reference != null) {
        contents += '\n' + '/*# sourceMappingURL=' + reference + ' */\n';
      }
    }

    return {
      contents,
      map,
    };
  },
}): Optimizer);

const BROWSER_MAPPING = {
  and_chr: 'chrome',
  and_ff: 'firefox',
  ie_mob: 'ie',
  op_mob: 'opera',
  and_qq: null,
  and_uc: null,
  baidu: null,
  bb: null,
  kaios: null,
  op_mini: null,
};

let cache = new Map();

function getTargets(browsers) {
  if (browsers == null) {
    return undefined;
  }

  let cached = cache.get(browsers);
  if (cached != null) {
    return cached;
  }

  let targets = {};
  for (let browser of browserslist(browsers)) {
    let [name, v] = browser.split(' ');
    if (BROWSER_MAPPING[name] === null) {
      continue;
    }

    let version = parseVersion(v);
    if (version == null) {
      continue;
    }

    if (targets[name] == null || version < targets[name]) {
      targets[name] = version;
    }
  }

  cache.set(browsers, targets);
  return targets;
}

function parseVersion(version) {
  let [major, minor = 0, patch = 0] = version
    .split('-')[0]
    .split('.')
    .map(v => parseInt(v, 10));

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    return null;
  }

  return (major << 16) | (minor << 8) | patch;
}
