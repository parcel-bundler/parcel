// @flow
import type {
  Asset,
  Bundle,
  BundleGraph,
  ModuleSpecifier,
  PluginOptions,
  Symbol,
} from '@parcel/types';

export type ExternalModule = {|
  source: ModuleSpecifier,
  specifiers: Map<Symbol, Symbol>,
  isCommonJS: ?boolean,
|};

export type ExternalBundle = {|
  bundle: Bundle,
  assets: Set<Asset>,
|};

export type OutputFormat = {|
  generateBundleImports(
    from: Bundle,
    bundle: Bundle,
    assets: Set<Asset>,
  ): Array<any>,
  generateExternalImport(
    bundle: Bundle,
    external: ExternalModule,
    scope: any,
  ): any,
  generateExports(
    bundleGraph: BundleGraph,
    bundle: Bundle,
    referencedAssets: Set<Asset>,
    path: any,
    replacements: Map<Symbol, Symbol>,
    options: PluginOptions,
  ): any,
|};
