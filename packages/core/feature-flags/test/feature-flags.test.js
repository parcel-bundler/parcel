// @flow strict
import assert from 'assert';
import {getFeatureFlag, DEFAULT_FEATURE_FLAGS, setFeatureFlags} from '../src';

describe('feature-flag test', () => {
  beforeEach(() => {
    setFeatureFlags(DEFAULT_FEATURE_FLAGS);
  });

  it('has defaults', () => {
    assert.equal(
      getFeatureFlag('exampleFeature'),
      DEFAULT_FEATURE_FLAGS.exampleFeature,
    );
  });

  it('can override', () => {
    setFeatureFlags({...DEFAULT_FEATURE_FLAGS, exampleFeature: true});
    assert.equal(getFeatureFlag('exampleFeature'), true);
  });
});
