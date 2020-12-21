// @flow
import type {Readable} from 'stream';

export interface Cache {
  +ensure?: () => Promise<void>;
  has(key: string): Promise<boolean>;
  get<T>(key: string): Promise<?T>;
  set(key: string, value: mixed): Promise<void>;
  getStream(key: string): Readable;
  setStream(key: string, stream: Readable): Promise<void>;
  getBlob<T>(key: string): Promise<?T>;
  setBlob(key: string, contents: Buffer | string): Promise<void>;
}
