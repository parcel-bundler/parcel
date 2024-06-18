// @flow

import type {FileSystem} from '@parcel/types';
import type {HandlerFunc, RpcEventRouter} from './RpcEventRouter';

//
// Events Defined in ~/crates/parcel_plugin_rpc/src/nodejs/file_system/file_system.rs
//
type ReadToStringHandler = HandlerFunc<'fs/read_to_string', string, string>;
type IsFileHandler = HandlerFunc<'fs/is_file', string, boolean>;
type IsDirHandler = HandlerFunc<'fs/is_dir', string, boolean>;

export class FileSystemRpc {
  constructor(rpc: RpcEventRouter, filesystem: FileSystem) {
    rpc.on<ReadToStringHandler>('fs/read_to_string', path => {
      return filesystem.readFileSync(path, 'utf8');
    });

    rpc.on<IsFileHandler>('fs/is_file', path => {
      return filesystem.statSync(path).isFile();
    });

    rpc.on<IsDirHandler>('fs/is_dir', path => {
      return filesystem.statSync(path).isDirectory();
    });
  }
}
