// @flow
import type {PackageJSON} from '@parcel/types';

export type REPLOptions = {|
  entries: [],
  minify: boolean,
  scopeHoist: boolean,
  sourceMaps: boolean,
  publicUrl: string,
  targetType: 'node' | 'browsers',
  targetEnv: null | string,
  outputFormat: null | 'esmodule' | 'commonjs' | 'global',
  mode: 'production' | 'development',
  hmr: boolean,
  renderGraphs: boolean,
  viewSourcemaps: boolean, // // unused
  dependencies: Array<[string, string]>,
  numWorkers: ?number,
|};

export function getDefaultTargetEnv(
  type: $ElementType<REPLOptions, 'targetType'>,
): string {
  switch (type) {
    case 'node':
      return '12';
    case 'browsers':
      return 'since 2019';
    default:
      throw new Error(`Missing default target env for ${type}`);
  }
}

export function generatePackageJson(options: REPLOptions): string {
  let app = {};
  if (options.outputFormat) {
    app.outputFormat = options.outputFormat;
  }

  let pkg: PackageJSON = {
    name: 'repl',
    version: '0.0.0',
    engines: {
      [(options.targetType: string)]:
        options.targetEnv || getDefaultTargetEnv(options.targetType),
    },
    targets: {
      app,
    },
    dependencies: Object.fromEntries(
      options.dependencies
        .filter(([a, b]) => a && b)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  };

  return JSON.stringify(pkg, null, 2);
}
