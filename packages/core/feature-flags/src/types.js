// @flow strict

export type FeatureFlags = {|
  +yarnWatcher: boolean,
  // This feature flag mostly exists to test the feature flag system, and doesn't have any build/runtime effect
  +exampleFeature: boolean,
|};
