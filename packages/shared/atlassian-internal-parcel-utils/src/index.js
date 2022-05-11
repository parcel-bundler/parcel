// @flow strict-local

import type {FilePath} from '@parcel/types';

import assert from 'assert';
import os from 'os';
import path from 'path';

const PATH_TO_NODE_MODULES = path.resolve(
  __dirname,
  process.env.PARCEL_BUILD_ENV === 'production' ? '../../..' : '../../../..',
);

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
    process.env.PARCEL_SELF_BUILD != null ||
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
      release:
        process.env.BITBUCKET_COMMIT /* Parcel repo commit on Bitbucket */,
      beforeSend(event) {
        for (const error of event.exception.values) {
          // Sanitize any referenced UNIX-style paths in the main error message
          error.value = error.value.replace(/\w?(\/.*)\b/g, p =>
            sanitizePath(p),
          );
          for (const frame of error.stacktrace.frames) {
            frame.filename = sanitizePath(frame.filename);
          }
        }
        return event;
      },
    });
    Sentry.setUser({username: os.userInfo().username});
  }

  return Sentry;
}

function sanitizePath(filePath: FilePath): FilePath {
  if (!path.isAbsolute(filePath)) {
    // If the path isn't absolute (e.g. previously sanitized, node internals
    // beginning with internal/, etc), this is safe to skip.
    return filePath;
  }

  const nodeModulesPos = filePath.indexOf(PATH_TO_NODE_MODULES);
  if (nodeModulesPos >= 0) {
    return (
      '[NODE_MODULES]' +
      filePath.slice(nodeModulesPos + PATH_TO_NODE_MODULES.length)
    );
  }

  // If node_modules isn't in this path, just use the basename
  return '[UNKNOWN]' + path.sep + path.basename(filePath);
}
