// @flow strict-local
import type {Diagnostic} from '@parcel/diagnostic';
import type {Async, QueryParameters} from '@parcel/types';
import type {StaticRunOpts} from '../RequestTracker';
import type {AssetGroup, Dependency, ParcelOptions} from '../types';
import type {ConfigAndCachePath} from './ParcelConfigRequest';

import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import {PluginLogger} from '@parcel/logger';
import {escapeMarkdown, relativePath} from '@parcel/utils';
import nullthrows from 'nullthrows';
import path from 'path';
import URL from 'url';
import querystring from 'querystring';
import {report} from '../ReporterRunner';
import PublicDependency from '../public/Dependency';
import PluginOptions from '../public/PluginOptions';
import ParcelConfig from '../ParcelConfig';
import createParcelConfigRequest, {
  getCachedParcelConfig,
} from './ParcelConfigRequest';

export type PathRequest = {|
  id: string,
  +type: 'path_request',
  run: RunOpts => Async<?AssetGroup>,
  input: PathRequestInput,
|};

export type PathRequestInput = {|
  dependency: Dependency,
  name: string,
|};

type RunOpts = {|
  input: PathRequestInput,
  ...StaticRunOpts<?AssetGroup>,
|};

const type = 'path_request';
const QUERY_PARAMS_REGEX = /^([^\t\r\n\v\f?]*)(\?.*)?/;

export default function createPathRequest(
  input: PathRequestInput,
): PathRequest {
  return {
    id: input.dependency.id + ':' + input.name,
    type,
    run,
    input,
  };
}

async function run({input, api, options}: RunOpts) {
  let configResult = nullthrows(
    await api.runRequest<null, ConfigAndCachePath>(createParcelConfigRequest()),
  );
  let config = getCachedParcelConfig(configResult, options);
  let resolverRunner = new ResolverRunner({
    options,
    config,
  });
  let assetGroup = await resolverRunner.resolve(input.dependency);

  if (assetGroup != null) {
    api.invalidateOnFileDelete(assetGroup.filePath);
  }

  return assetGroup;
}

type ResolverRunnerOpts = {|
  config: ParcelConfig,
  options: ParcelOptions,
|};

export class ResolverRunner {
  config: ParcelConfig;
  options: ParcelOptions;
  pluginOptions: PluginOptions;

  constructor({config, options}: ResolverRunnerOpts) {
    this.config = config;
    this.options = options;
    this.pluginOptions = new PluginOptions(this.options);
  }

  async getThrowableDiagnostic(
    dependency: Dependency,
    message: string,
  ): Async<ThrowableDiagnostic> {
    let diagnostic: Diagnostic = {
      message,
      origin: '@parcel/core',
    };

    if (dependency.loc && dependency.sourcePath != null) {
      diagnostic.filePath = dependency.sourcePath;
      diagnostic.codeFrame = {
        code: await this.options.inputFS.readFile(
          dependency.sourcePath,
          'utf8',
        ),
        codeHighlights: dependency.loc
          ? [{start: dependency.loc.start, end: dependency.loc.end}]
          : [],
      };
    }

    return new ThrowableDiagnostic({diagnostic});
  }

  async resolve(dependency: Dependency): Promise<?AssetGroup> {
    let dep = new PublicDependency(dependency);
    report({
      type: 'buildProgress',
      phase: 'resolving',
      dependency: dep,
    });

    let resolvers = await this.config.getResolvers();

    let pipeline;
    let filePath;
    let query: ?QueryParameters;
    let validPipelines = new Set(this.config.getNamedPipelines());
    if (
      // Don't consider absolute paths. Absolute paths are only supported for entries,
      // and include e.g. `C:\` on Windows, conflicting with pipelines.
      !path.isAbsolute(dependency.moduleSpecifier) &&
      dependency.moduleSpecifier.includes(':')
    ) {
      [pipeline, filePath] = dependency.moduleSpecifier.split(':');
      if (!validPipelines.has(pipeline)) {
        if (dep.isURL) {
          // This may be a url protocol or scheme rather than a pipeline, such as
          // `url('http://example.com/foo.png')`
          return null;
        } else {
          throw await this.getThrowableDiagnostic(
            dependency,
            `Unknown pipeline: ${pipeline}.`,
          );
        }
      }
    } else {
      if (dependency.isURL && dependency.moduleSpecifier.startsWith('//')) {
        // A protocol-relative URL, e.g `url('//example.com/foo.png')`
        return null;
      }
      filePath = dependency.moduleSpecifier;
    }

    let queryPart = null;
    if (dependency.isURL) {
      let parsed = URL.parse(filePath);
      if (typeof parsed.pathname !== 'string') {
        throw await this.getThrowableDiagnostic(
          dependency,
          `Received URL without a pathname ${filePath}.`,
        );
      }
      filePath = decodeURIComponent(parsed.pathname);
      if (parsed.query != null) {
        queryPart = parsed.query;
      }
    } else {
      let matchesQuerystring = filePath.match(QUERY_PARAMS_REGEX);
      if (matchesQuerystring && matchesQuerystring[2] != null) {
        filePath = matchesQuerystring[1];
        queryPart = matchesQuerystring[2].substr(1);
      }
    }
    if (queryPart != null) {
      query = querystring.parse(queryPart);
    }

    let diagnostics: Array<Diagnostic> = [];
    for (let resolver of resolvers) {
      try {
        let result = await resolver.plugin.resolve({
          filePath,
          dependency: dep,
          options: this.pluginOptions,
          logger: new PluginLogger({origin: resolver.name}),
        });

        if (result) {
          if (result.meta) {
            dependency.meta = {
              ...dependency.meta,
              ...result.meta,
            };
          }

          if (result.isExcluded) {
            return null;
          }

          if (result.filePath != null) {
            return {
              canDefer: result.canDefer,
              filePath: result.filePath,
              query,
              sideEffects: result.sideEffects,
              code: result.code,
              env: dependency.env,
              pipeline: pipeline ?? dependency.pipeline,
              isURL: dependency.isURL,
            };
          }

          if (result.diagnostics) {
            let errorDiagnostic = errorToDiagnostic(
              new ThrowableDiagnostic({diagnostic: result.diagnostics}),
              resolver.name,
            );
            diagnostics.push(...errorDiagnostic);
          }
        }
      } catch (e) {
        // Add error to error map, we'll append these to the standard error if we can't resolve the asset
        let errorDiagnostic = errorToDiagnostic(e, resolver.name);
        if (Array.isArray(errorDiagnostic)) {
          diagnostics.push(...errorDiagnostic);
        } else {
          diagnostics.push(errorDiagnostic);
        }

        break;
      }
    }

    if (dep.isOptional) {
      return null;
    }

    let resolveFrom = dependency.resolveFrom ?? dependency.sourcePath;
    let dir =
      resolveFrom != null
        ? escapeMarkdown(relativePath(this.options.projectRoot, resolveFrom))
        : '';

    let specifier = escapeMarkdown(dependency.moduleSpecifier || '');

    // $FlowFixMe because of the err.code assignment
    let err = await this.getThrowableDiagnostic(
      dependency,
      `Failed to resolve '${specifier}' ${dir ? `from '${dir}'` : ''}`,
    );

    // Merge diagnostics
    err.diagnostics.push(...diagnostics);
    err.code = 'MODULE_NOT_FOUND';

    throw err;
  }
}
