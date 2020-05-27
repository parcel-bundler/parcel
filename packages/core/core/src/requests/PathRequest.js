// @flow strict-local
import type {Diagnostic} from '@parcel/diagnostic';
import type {Async} from '@parcel/types';
import type ParcelConfig from '../ParcelConfig';
import type {StaticRunOpts} from '../RequestTracker';
import type {AssetGroup, Dependency, ParcelOptions} from '../types';

import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import {PluginLogger} from '@parcel/logger';
import {escapeMarkdown, relatifyPath} from '@parcel/utils';
import path from 'path';
import URL from 'url';
import {report} from '../ReporterRunner';
import PublicDependency from '../public/Dependency';
import PluginOptions from '../public/PluginOptions';

export type PathRequestInput = {|dependency: Dependency, config: ParcelConfig|};
export type PathRequestResult = AssetGroup | null | void;

export type PathRequest = {|
  id: string,
  +type: 'path_request',
  run: RunOpts => Promise<PathRequestResult>,
  input: PathRequestInput,
|};

type RunOpts = {|
  input: PathRequestInput,
  ...StaticRunOpts,
|};

const type = 'path_request';

export default function createPathRequest(input: PathRequestInput) {
  return {
    id: input.dependency.id,
    type,
    run,
    input,
  };
}
async function run({input, api, options}: RunOpts) {
  let {config, dependency} = input;
  let resolverRunner = new ResolverRunner({options, config});
  let assetGroup = await resolverRunner.resolve(dependency);

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
      if (pipeline == null) {
        pipeline = 'url';
      }
    }

    let errors: Array<ThrowableDiagnostic> = [];
    for (let resolver of resolvers) {
      try {
        let result = await resolver.plugin.resolve({
          filePath,
          dependency: dep,
          options: this.pluginOptions,
          logger: new PluginLogger({origin: resolver.name}),
        });

        if (result && result.isExcluded) {
          return null;
        }

        if (result?.filePath != null) {
          return {
            filePath: result.filePath,
            sideEffects: result.sideEffects,
            code: result.code,
            env: dependency.env,
            pipeline: pipeline ?? dependency.pipeline,
          };
        }
      } catch (e) {
        // Add error to error map, we'll append these to the standard error if we can't resolve the asset
        errors.push(
          new ThrowableDiagnostic({
            diagnostic: errorToDiagnostic(e, resolver.name),
          }),
        );
      }
    }

    if (dep.isOptional) {
      return null;
    }

    let dir =
      dependency.sourcePath != null
        ? escapeMarkdown(
            relatifyPath(this.options.projectRoot, dependency.sourcePath),
          )
        : '';

    let specifier = escapeMarkdown(dependency.moduleSpecifier || '');

    // $FlowFixMe because of the err.code assignment
    let err = await this.getThrowableDiagnostic(
      dependency,
      `Failed to resolve '${specifier}' ${dir ? `from '${dir}'` : ''}`,
    );

    // Merge resolver errors
    if (errors.length) {
      for (let error of errors) {
        err.diagnostics.push(...error.diagnostics);
      }
    }

    err.code = 'MODULE_NOT_FOUND';

    throw err;
  }
}
