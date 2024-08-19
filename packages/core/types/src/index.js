// @flow strict-local

import type WorkerFarm from '@atlaspack/workers';
import type {InitialAtlaspackOptionsInternal} from '@atlaspack/types-internal';

export type * from '@atlaspack/types-internal';

export type InitialAtlaspackOptions =
  InitialAtlaspackOptionsInternal<WorkerFarm>;
