// @flow strict

type FeatureFlagDefinitions = {|
  [string]: {|
    description: string,
    defaultValue: boolean | string,
  |},
|};

export type FeatureFlags = {|
  +exampleFeature: boolean,
|};

// This export is designed to be used for when feature flag information is required in other
// places - mostly the intention is to use this in the CLI to validate feature flag options and
// convert them to `FeatureFlags` passed to the Parcel API.
export const featureFlags: FeatureFlagDefinitions = {
  exampleFeature: {
    description:
      'Test feature flag to ensure the feature flag types flow correctly.',
    defaultValue: false,
  },
};

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  exampleFeature: false,
};
