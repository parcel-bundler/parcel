// @flow strict-local
import type {
  Asset,
  Bundle,
  BundleGraph,
  ModuleSpecifier,
  PluginOptions,
  Symbol,
} from '@parcel/types';
import type {NodePath, Scope} from '@babel/traverse';
import type {Node, Program} from '@babel/types';

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
    scope: Scope,
  ): Array<Node>,
  generateExternalImport(
    bundle: Bundle,
    external: ExternalModule,
    scope: Scope,
  ): Array<Node>,
  generateExports(
    bundleGraph: BundleGraph,
    bundle: Bundle,
    referencedAssets: Set<Asset>,
    path: NodePath<Program>,
    replacements: Map<Symbol, Symbol>,
    options: PluginOptions,
  ): Set<Symbol>,
|};
