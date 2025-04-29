// @flow
import type {
  Environment,
  EnvironmentOptions,
  DependencyOptions,
  TransformerResult,
} from '@parcel/types';
import type {RustEnvironment, RustDependency, RustAsset} from '../';

const IS_LIBRARY = 1 << 0;
const SHOULD_OPTIMIZE = 1 << 1;
const SHOULD_SCOPE_HOIST = 1 << 2;

export function envToRust(env: Environment): RustEnvironment {
  let flags = 0;
  if (env.isLibrary) {
    flags |= IS_LIBRARY;
  }
  if (env.shouldOptimize) {
    flags |= SHOULD_OPTIMIZE;
  }
  if (env.shouldScopeHoist) {
    flags |= SHOULD_SCOPE_HOIST;
  }
  return {
    context: env.context,
    outputFormat: env.outputFormat,
    sourceType: env.sourceType,
    flags,
    sourceMap: null,
    loc: null,
    includeNodeModules: env.includeNodeModules,
    engines: env.engines,
  };
}

export function envFromRust(env: RustEnvironment): EnvironmentOptions {
  return {
    context: env.context,
    outputFormat: env.outputFormat,
    sourceType: env.sourceType,
    isLibrary: Boolean(env.flags & IS_LIBRARY),
    shouldOptimize: Boolean(env.flags & SHOULD_OPTIMIZE),
    shouldScopeHoist: Boolean(env.flags & SHOULD_SCOPE_HOIST),
    sourceMap: env.sourceMap,
    loc: env.loc,
    includeNodeModules: env.includeNodeModules,
    engines: undefined, // ignore for now
  };
}

// const ENTRY    = 1 << 0;
const OPTIONAL = 1 << 1;
const NEEDS_STABLE_NAME = 1 << 2;
// const SHOULD_WRAP = 1 << 3;
// const IS_ESM = 1 << 4;
// const IS_WEBWORKER = 1 << 5;
// const HAS_SYMBOLS = 1 << 6;

export function dependencyFromRust(dep: RustDependency): DependencyOptions {
  return {
    specifier: dep.specifier,
    specifierType: dep.specifierType,
    priority: dep.priority,
    bundleBehavior:
      dep.bundleBehavior === 'none' ? undefined : dep.bundleBehavior,
    isOptional: Boolean(dep.flags & OPTIONAL),
    needsStableName: Boolean(dep.flags & NEEDS_STABLE_NAME),
    env: envFromRust(dep.env),
    loc: dep.loc,
    meta: {
      placeholder: dep.placeholder,
    },
    resolveFrom: dep.resolveFrom,
    range: dep.range,
  };
}

// const IS_SOURCE = 1 << 0;
// const SIDE_EFFECTS = 1 << 1;
// const IS_BUNDLE_SPLITTABLE = 1 << 2;
// const LARGE_BLOB = 1 << 3;
// const HAS_CJS_EXPORTS = 1 << 4;
// const STATIC_EXPORTS = 1 << 5;
// const SHOULD_WRAP = 1 << 6;
// const IS_CONSTANT_MODULE = 1 << 7;
// const HAS_NODE_REPLACEMENTS = 1 << 8;
// const HAS_SYMBOLS = 1 << 9;
const IS_HTML_ATTR = 1 << 10;
const IS_HTML_TAG = 1 << 11;

export function assetFromRust(asset: RustAsset): TransformerResult {
  let meta = {};
  if (asset.flags & IS_HTML_ATTR) {
    meta.type = 'attr';
  }
  if (asset.flags & IS_HTML_TAG) {
    meta.type = 'tag';
  }
  if (asset.loc) {
    meta.startLine = asset.loc.start.line;
  }
  return {
    type: asset.type,
    content: asset.content,
    uniqueKey: asset.uniqueKey,
    bundleBehavior:
      asset.bundleBehavior === 'none' ? undefined : asset.bundleBehavior,
    env: envFromRust(asset.env),
    // isBundleSplittable: Boolean(asset.flags & IS_BUNDLE_SPLITTABLE),
    // sideEffects
    meta,
  };
}
