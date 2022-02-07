// @flow
import path from 'path';
import process from 'process';
import {Optimizer} from '@parcel/plugin';
import {blobToBuffer} from '@parcel/utils';
import {md} from '@parcel/diagnostic';
import {optimize} from '../native';
import WorkerFarm from '@parcel/workers';

export default (new Optimizer({
  async optimize({bundle, contents, logger}) {
    if (!bundle.env.shouldOptimize) {
      return {contents};
    }

    await loadOnMainThreadIfNeeded();
    let buffer = await blobToBuffer(contents);

    // Attempt to optimize it, if the optimize fails we log a warning...
    try {
      let optimized = optimize(bundle.type, buffer);
      return {
        contents: optimized.length < buffer.length ? optimized : buffer,
      };
    } catch (err) {
      const filepath = bundle.getMainEntry()?.filePath;
      const filename = filepath
        ? path.relative(process.cwd(), filepath)
        : 'unknown';
      logger.warn({
        message: md`Could not optimize image ${filename}: ${err.message}`,
        stack: err.stack,
      });
    }

    return {contents: buffer};
  },
}): Optimizer);

// On linux with older versions of glibc (e.g. CentOS 7), we encounter a segmentation fault
// when worker threads exit due to thread local variables in Rust. A workaround is to
// also load the native module on the main thread, so that it is not unloaded until process exit.
// See https://github.com/rust-lang/rust/issues/91979.
let isLoadedOnMainThread = false;
async function loadOnMainThreadIfNeeded() {
  if (
    !isLoadedOnMainThread &&
    process.platform === 'linux' &&
    WorkerFarm.isWorker()
  ) {
    let {family, version} = require('detect-libc');
    if (family === 'glibc' && parseFloat(version) <= 2.17) {
      let api = WorkerFarm.getWorkerApi();
      await api.callMaster({
        location: __dirname + '/loadNative.js',
        args: [],
      });

      isLoadedOnMainThread = true;
    }
  }
}
