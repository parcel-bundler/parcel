import type {FileSystem} from '@parcel/types';
import type WorkerFarm from '@parcel/workers';

export type {
  FileSystem,
  FileOptions,
  ReaddirOptions,
  Stats,
  Encoding,
  Dirent,
} from '@parcel/types/FileSystem';

export const NodeFS: {
  new (): FileSystem;
};

export const MemoryFS: {
  new (farm: WorkerFarm): FileSystem;
};

export const OverlayFS: {
  new (writable: FileSystem, readable: FileSystem): FileSystem;
};
