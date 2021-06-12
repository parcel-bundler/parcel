// @flow strict-local
import type {Async} from '@parcel/types';
import type SourceMap from '@parcel/source-map';
import {Packager} from '@parcel/plugin';
import {replaceInlineReferences} from '@parcel/utils';
import {hashString} from '@parcel/hash';
import path from 'path';
import nullthrows from 'nullthrows';
import {DevPackager} from './DevPackager';
import {ScopeHoistingPackager} from './ScopeHoistingPackager';

export default (new Packager({
  async loadConfig({config, options}) {
    // Generate a name for the global parcelRequire function that is unique to this project.
    // This allows multiple parcel builds to coexist on the same page.
    let pkg = await config.getConfigFrom(
      path.join(options.entryRoot, 'index'),
      ['package.json'],
    );
    let name = pkg?.contents?.name ?? '';
    config.setResult({
      parcelRequireName: 'parcelRequire' + hashString(name).slice(-4),
    });
  },
  async package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    getSourceMapReference,
    config,
    options,
  }) {
    let packager = bundle.env.shouldScopeHoist
      ? new ScopeHoistingPackager(
          options,
          bundleGraph,
          bundle,
          nullthrows(config).parcelRequireName,
        )
      : new DevPackager(
          options,
          bundleGraph,
          bundle,
          nullthrows(config).parcelRequireName,
        );

    let {contents, map} = await packager.package();
    contents += '\n' + (await getSourceMapSuffix(getSourceMapReference, map));

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
