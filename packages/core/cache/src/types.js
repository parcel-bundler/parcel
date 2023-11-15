// @flow
import type {Readable} from 'stream';
import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';

export interface Cache {
  ensure(): Promise<void>;
  has(key: string): Promise<boolean>;
  get<T>(key: string): Promise<?T>;
  set(key: string, value: mixed): Promise<void>;
  getStream(key: string): Readable;
  setStream(key: string, stream: Readable): Promise<void>;
  getBlob(key: string): Promise<Buffer>;
  setBlob(key: string, contents: Buffer | string): Promise<void>;
  hasLargeBlob(key: string): Promise<boolean>;
  getLargeBlob(key: string): Promise<Buffer>;
  setLargeBlob(
    key: string,
    contents: Buffer | string,
    options?: {|signal?: AbortSignal|},
  ): Promise<void>;
  getBuffer(key: string): Promise<?Buffer>;
  /**
   * In a multi-threaded environment, where there are potentially multiple Cache
   * instances writing to the cache, ensure that this instance has the latest view
   * of the changes that may have been written to the cache in other threads.
   */
  refresh(): void;
}
