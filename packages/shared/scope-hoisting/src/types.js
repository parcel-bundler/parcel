// @flow strict-local
import type {
  Asset,
  BundleGraph,
  ModuleSpecifier,
  NamedBundle,
  Symbol,
  SourceLocation,
} from '@parcel/types';
import type {Node, Statement} from '@babel/types';
import type {Scope} from '@parcel/babylon-walk';

export type ExternalModule = {|
  source: ModuleSpecifier,
  specifiers: Map<Symbol, Symbol>,
  isCommonJS: ?boolean,
  loc?: ?SourceLocation,
|};

export type ExternalBundle = {|
  bundle: NamedBundle,
  assets: Set<Asset>,
  loc?: ?SourceLocation,
|};

export type OutputFormat = {|
  generateBundleImports(
    bundleGraph: BundleGraph<NamedBundle>,
    from: NamedBundle,
    external: ExternalBundle,
    scope: Scope,
  ): {|hoisted: Array<Statement>, imports: Array<Statement>|},
  generateExternalImport(
    bundle: NamedBundle,
    external: ExternalModule,
    scope: Scope,
  ): Array<Statement>,
  generateBundleExports(
    bundleGraph: BundleGraph<NamedBundle>,
    bundle: NamedBundle,
    referencedAssets: Set<Asset>,
    scope: Scope,
    reexports: Set<{|exportAs: string, local: string|}>,
  ): Array<Statement>,
  generateMainExport(
    node: Node,
    exported: Array<{|exportAs: string, local: string|}>,
  ): Array<Node>,
|};
