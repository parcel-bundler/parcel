// @flow
import type {Async} from '@parcel/types';
import type SourceMap from '@parcel/source-map';
import {Packager} from '@parcel/plugin';
import {replaceInlineReferences} from '@parcel/utils';
import {DevPackager} from './DevPackager';
import {SWCPackager} from './SWCPackager';

export default (new Packager({
  async package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    getSourceMapReference,
    config,
    options,
  }) {
    let parcelRequireName = 'parcelRequire123'; // TODO
    let packager = bundle.env.shouldScopeHoist
      ? new SWCPackager(options, bundleGraph, bundle, parcelRequireName)
      : new DevPackager(options, bundleGraph, bundle, parcelRequireName);

    let {contents, map} = await packager.package();
    contents += '\n' + await getSourceMapSuffix(getSourceMapReference, map);

    return replaceInlineReferences({
      bundle,
      bundleGraph,
      contents,
      getInlineReplacement: (dependency, inlineType, content) => ({
        from: `"${dependency.id}"`,
        to: inlineType === 'string' ? JSON.stringify(content) : content,
      }),
      getInlineBundleContents,
      map,
    });
  },
}): Packager);

async function getSourceMapSuffix(
  getSourceMapReference: (?SourceMap) => Async<?string>,
  map: ?SourceMap,
): Promise<string> {
  let sourcemapReference = await getSourceMapReference(map);
  if (sourcemapReference != null) {
    return '//# sourceMappingURL=' + sourcemapReference + '\n';
  } else {
    return '';
  }
}
