// @flow strict-local

import assert from 'assert';
import os from 'os';

let Sentry;
export function getSentry() {
  if (Sentry == null) {
    // $FlowFixMe Sentry is untyped
    Sentry = require('@sentry/node');
    assert(process.env.SENTRY_DSN != null);

    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      release: process.env.BITBUCKET_COMMIT,
    });
    Sentry.configureScope(scope => {
      scope.setUser({
        username: os.userInfo().username,
      });
    });
  }

  return Sentry;
}
