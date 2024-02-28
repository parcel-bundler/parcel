// @flow strict

export type FeatureFlags = {|
  +exampleFeature: boolean,
|};

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  exampleFeature: false,
};
