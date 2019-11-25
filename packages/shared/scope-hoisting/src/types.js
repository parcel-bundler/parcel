// @flow
import type {ModuleSpecifier, Symbol, Bundle, Asset} from '@parcel/types';

export type ExternalModule = {|
  source: ModuleSpecifier,
  specifiers: Map<Symbol, Symbol>,
  isCommonJS: ?boolean
|};

export type ExternalBundle = {|
  bundle: Bundle,
  assets: Set<Asset>
|};
