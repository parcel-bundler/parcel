// @flow strict-local

import assert from 'assert';

interface ISentry {
  captureException(mixed): void;
  getCurrentHub(): {
    getClient(): ?{
      close(): Promise<mixed>,
      ...
    },
    ...
  };
}

const NullSentry = {
  captureException() {},
  getCurrentHub() {
    return {
      getClient() {
        return null;
      },
    };
  },
};

let Sentry;
export function getSentry(): ISentry {
  if (
    process.env.PARCEL_BUILD_ENV !== 'production' ||
    process.env.PARCEL_ANALYTICS_DISABLE != null
  ) {
    return NullSentry;
  }

  if (Sentry == null) {
    // $FlowFixMe Sentry is untyped
    Sentry = require('@sentry/node');
    assert(process.env.SENTRY_DSN != null);

    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      release: process.env.BITBUCKET_COMMIT,
    });
  }

  return Sentry;
}
