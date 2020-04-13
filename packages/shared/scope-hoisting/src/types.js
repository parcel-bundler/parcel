// @flow strict-local
import type {
  Asset,
  Bundle,
  BundleGraph,
  ModuleSpecifier,
  PluginOptions,
  Symbol,
} from '@parcel/types';
import type {NodePath} from '@babel/traverse';
import type {Program} from '@babel/types';

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
    path: NodePath<Program>,
  ): void,
  generateExternalImport(
    bundle: Bundle,
    external: ExternalModule,
    path: NodePath<Program>,
  ): void,
  generateExports(
    bundleGraph: BundleGraph,
    bundle: Bundle,
    referencedAssets: Set<Asset>,
    path: NodePath<Program>,
    replacements: Map<Symbol, Symbol>,
    options: PluginOptions,
  ): Set<Symbol>,
|};
