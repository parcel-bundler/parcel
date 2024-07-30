// @flow strict

export type FeatureFlags = {|
  // This feature flag mostly exists to test the feature flag system, and doesn't have any build/runtime effect
  +exampleFeature: boolean,
  /**
   * Rust backed requests
   */
  +parcelV3: boolean,
  /**
   * Configure runtime to enable retriable dynamic imports
   */
  importRetry: boolean,
  /**
   * Enable resolver refactor into owned data structures.
   */
  ownedResolverStructures: boolean,
  /**
   * Tiered imports API
   * Enable tier imports
   *
   * Tier imports allow developers to have control over when code is loaded
   */
  +tieredImports: boolean,
|};
