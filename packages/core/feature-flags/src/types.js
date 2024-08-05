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
   * Makes Parcel panic when an empty file is imported
   */
  panicOnEmptyFileImport: boolean,
|};
