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
import createParcelConfigRequest from './ParcelConfigRequest';

export type PathRequestResult = AssetGroup | null | void;

export type PathRequest = {|
  id: string,
  +type: 'path_request',
  run: RunOpts => Promise<PathRequestResult>,
  input: Dependency,
|};

type RunOpts = {|
  input: Dependency,
  ...StaticRunOpts,
|};

const type = 'path_request';
const QUERY_PARAMS_REGEX = /^([^\t\r\n\v\f?]*)(\?.*)?/;

export default function createPathRequest(
  input: Dependency,
): {|
  id: string,
  input: Dependency,
  run: ({|input: Dependency, ...StaticRunOpts|}) => Async<?AssetGroup>,
  +type: string,
|} {
  return {
    id: input.id,
    type,
    run,
    input,
  };
}
async function run({input, api, options}: RunOpts) {
  let {config} = nullthrows(
    await api.runRequest<null, ConfigAndCachePath>(createParcelConfigRequest()),
  );
  let resolverRunner = new ResolverRunner({
    options,
    config: new ParcelConfig(
      config,
      options.packageManager,
      options.inputFS,
      options.autoinstall,
    ),
  });
  let assetGroup = await resolverRunner.resolve(input);

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
    let query: QueryParameters = {};
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
          throw new Error(`Unknown pipeline ${pipeline}.`);
        }
      }
    } else {
      if (dependency.isURL && dependency.moduleSpecifier.startsWith('//')) {
        // A protocol-relative URL, e.g `url('//example.com/foo.png')`
        return null;
      }
      filePath = dependency.moduleSpecifier;
    }

    if (dependency.isURL) {
      let parsed = URL.parse(filePath);
      if (typeof parsed.pathname !== 'string') {
        throw new Error(`Received URL without a pathname ${filePath}.`);
      }
      filePath = decodeURIComponent(parsed.pathname);
    }

    let matchesQuerystring = filePath.match(QUERY_PARAMS_REGEX);
    if (matchesQuerystring && matchesQuerystring.length > 2) {
      filePath = matchesQuerystring[1];
      query = matchesQuerystring[2]
        ? querystring.parse(matchesQuerystring[2].substr(1))
        : {};
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
            if (Array.isArray(result.diagnostics)) {
              diagnostics.push(...result.diagnostics);
            } else {
              diagnostics.push(result.diagnostics);
            }
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

    let dir =
      dependency.sourcePath != null
        ? escapeMarkdown(
            relativePath(this.options.projectRoot, dependency.sourcePath),
          )
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
