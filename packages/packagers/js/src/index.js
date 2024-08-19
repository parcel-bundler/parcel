// @flow strict-local
import type {Async} from '@atlaspack/types';
import type SourceMap from '@parcel/source-map';
import {Packager} from '@atlaspack/plugin';
import {
  replaceInlineReferences,
  replaceURLReferences,
  validateSchema,
  type SchemaEntity,
} from '@atlaspack/utils';
import {encodeJSONKeyComponent} from '@atlaspack/diagnostic';
import {hashString} from '@atlaspack/rust';
import nullthrows from 'nullthrows';
import {DevPackager} from './DevPackager';
import {ScopeHoistingPackager} from './ScopeHoistingPackager';

type JSPackagerConfig = {|
  atlaspackRequireName: string,
  unstable_asyncBundleRuntime: boolean,
|};

const CONFIG_SCHEMA: SchemaEntity = {
  type: 'object',
  properties: {
    unstable_asyncBundleRuntime: {
      type: 'boolean',
    },
  },
  additionalProperties: false,
};

export default (new Packager({
  async loadConfig({config, options}): Promise<JSPackagerConfig> {
    let packageKey = '@atlaspack/packager-js';
    let conf = await config.getConfigFrom(options.projectRoot + '/index', [], {
      packageKey,
    });

    if (conf?.contents) {
      validateSchema.diagnostic(
        CONFIG_SCHEMA,
        {
          data: conf?.contents,
          source: await options.inputFS.readFile(conf.filePath, 'utf8'),
          filePath: conf.filePath,
          prependKey: `/${encodeJSONKeyComponent(packageKey)}`,
        },
        packageKey,
        `Invalid config for ${packageKey}`,
      );
    }

    // Generate a name for the global atlaspackRequire function that is unique to this project.
    // This allows multiple atlaspack builds to coexist on the same page.
    let packageName = await config.getConfigFrom(
      options.projectRoot + '/index',
      [],
      {
        packageKey: 'name',
      },
    );

    let name = packageName?.contents?.name ?? '';
    return {
      atlaspackRequireName: 'atlaspackRequire' + hashString(name).slice(-4),
      unstable_asyncBundleRuntime: Boolean(
        conf?.contents?.unstable_asyncBundleRuntime,
      ),
    };
  },
  async package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    getSourceMapReference,
    config,
    options,
  }) {
    // If this is a non-module script, and there is only one asset with no dependencies,
    // then we don't need to package at all and can pass through the original code un-wrapped.
    let contents, map;
    if (bundle.env.sourceType === 'script') {
      let entries = bundle.getEntryAssets();
      if (
        entries.length === 1 &&
        bundleGraph.getDependencies(entries[0]).length === 0
      ) {
        contents = await entries[0].getCode();
        map = await entries[0].getMap();
      }
    }

    if (contents == null) {
      let packager = bundle.env.shouldScopeHoist
        ? new ScopeHoistingPackager(
            options,
            bundleGraph,
            bundle,
            nullthrows(config).atlaspackRequireName,
            nullthrows(config).unstable_asyncBundleRuntime,
          )
        : new DevPackager(
            options,
            bundleGraph,
            bundle,
            nullthrows(config).atlaspackRequireName,
          );

      ({contents, map} = await packager.package());
    }

    contents += '\n' + (await getSourceMapSuffix(getSourceMapReference, map));

    // For library builds, we need to replace URL references with their final resolved paths.
    // For non-library builds, this is handled in the JS runtime.
    if (bundle.env.isLibrary) {
      ({contents, map} = replaceURLReferences({
        bundle,
        bundleGraph,
        contents,
        map,
        getReplacement: s => JSON.stringify(s).slice(1, -1),
      }));
    }

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
