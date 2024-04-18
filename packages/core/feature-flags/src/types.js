// @flow strict

export type FeatureFlags = {|
  // This feature flag mostly exists to test the feature flag system, and doesn't have any build/runtime effect
  +exampleFeature: boolean,
  /**
   * Enables content hash based invalidation for config keys used in plugins.
   * This allows Assets not to be invalidated when using
   * `config.getConfigFrom(..., {packageKey: '...'})` and the value itself hasn't changed.
   */
  +configKeyInvalidation: boolean,
  /**
   * Refactors dfsNew to use an iterative approach.
   */
  +dfsFasterRefactor: boolean,
|};
