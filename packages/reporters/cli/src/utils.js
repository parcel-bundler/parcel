// @flow strict-local

import type {BuildProgressEvent} from '@parcel/types';

import path from 'path';

export function getProgressMessage(event: BuildProgressEvent): ?string {
  switch (event.phase) {
    case 'transforming':
      return `Building ${event.request.filePath}...`;

    case 'bundling':
      return 'Bundling...';

    case 'packaging':
      return `Packaging ${event.bundle.filePath || ''}...`;

    case 'optimizing':
      return `Optimizing ${event.bundle.filePath || ''}...`;
  }

  return null;
}
