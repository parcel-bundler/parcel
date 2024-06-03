// @flow strict-local

import assert from 'assert';
import {createEnvironment} from '../src/Environment';
import PublicEnvironment from '../src/public/Environment';
import {DEFAULT_OPTIONS} from './test-utils';

describe('Public Environment', () => {
  it('has correct support data for ChromeAndroid', () => {
    let env = new PublicEnvironment(
      createEnvironment({
        engines: {
          browsers: ['last 1 Chrome version', 'last 1 ChromeAndroid version'],
        },
      }),
      DEFAULT_OPTIONS,
    );

    assert(env.supports('esmodules'));
    assert(env.supports('dynamic-import'));
    assert(env.supports('worker-module'));
    assert(env.supports('import-meta-url'));
    assert(env.supports('arrow-functions'));
  });
  it('matches browserslist for es6-modules support', () => {
    let env = new PublicEnvironment(
      createEnvironment({
        engines: {browsers: 'fully supports es6-module'},
      }),
      DEFAULT_OPTIONS,
    );
    assert(env.supports('esmodules'));
  });
  it('matches browserslist for dynamic-imports support', () => {
    let env = new PublicEnvironment(
      createEnvironment({
        engines: {browsers: 'fully supports es6-module-dynamic-import'},
      }),
      DEFAULT_OPTIONS,
    );
    assert(env.supports('dynamic-import'));
  });
  it('matches browserslist for arrow-functions support', () => {
    let env = new PublicEnvironment(
      createEnvironment({
        engines: {browsers: 'fully supports arrow-functions'},
      }),
      DEFAULT_OPTIONS,
    );
    assert(env.supports('arrow-functions'));
  });
});
