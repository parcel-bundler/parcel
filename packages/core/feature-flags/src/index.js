// @flow strict

export const featureFlags = {
  exampleFeature: {
    type: 'boolean',
    description:
      'Test feature flag to ensure the feature flag types flow correctly.',
  },
};

export type FeatureFlags = {|
  +exampleFeature?: boolean,
|};
