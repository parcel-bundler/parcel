if (process.browser) {
  const MemoryFileSystem = require('memory-fs');
  const fs = new MemoryFileSystem();
  for (let f in MemoryFileSystem.prototype) {
    if (typeof MemoryFileSystem.prototype[f] === 'function') {
      fs[f] = MemoryFileSystem.prototype[f].bind(fs);
    }
  }
  fs.lstat = fs.stat;
  const createWriteStream = fs.createWriteStream;
  fs.createWriteStream = path => {
    const s = createWriteStream(path);
    return {
      bytesWritten: 0,
      write(data, cb) {
        this.bytesWritten += data.length;
        return s.write(data, cb);
      },
      end(cb) {
        return s.end(cb);
      }
    };
  };
  window.fs = fs;
  module.exports = fs;
  // const {memoryFS} = require('./fs.js');
  // const contentstream = require('contentstream');

  // exports.memoryFSClear = () => memoryFS.clear();
  // exports.readFileSync = path => memoryFS.get(path);
  // exports.readFile = (path, cbOrEnc, cb) => {
  //   if (!cb) cb = cbOrEnc;
  //   if (memoryFS.has(path)) {
  //     cb(null, exports.readFileSync(path));
  //   } else {
  //     cb({code: 'ENOENT'});
  //   }
  // };
  // exports.writeFile = (path, data, cb) => cb(null, memoryFS.set(path, data));
  // exports.stat = (path, cb) => {
  //   if (memoryFS.has(path)) {
  //     // const f = memoryFS.get(path);
  //     cb(null, {
  //       isFile: () => true
  //     });
  //   } else if (Array.from(memoryFS.values()).some(v => v.startsWith(path))) {
  //     cb(null, {
  //       isDirectory: () => true,
  //       isFile: () => false
  //     });
  //   } else {
  //     cb({code: 'ENOENT'});
  //   }
  // };
  // exports.readdir = (path, cb) => {
  //   const keys = Array.from(memoryFS.keys());
  //   cb(null, keys.filter(v => v.startsWith(path)));
  // };
  // exports.unlink = (path, cb) => cb(null, memoryFS.delete(path));
  // exports.lstat = exports.stat;
  // exports.existsSync = path => memoryFS.has(path);
  // exports.exists = (path, cb) => cb(exports.existsSync(path));
  // exports.mkdirp = () => {};
  // exports.createWriteStream = path => {
  //   return {
  //     write(v) {
  //       this.bytesWritten += v.length;
  //       if (memoryFS.has(path)) {
  //         memoryFS.set(path, memoryFS.get(path) + v);
  //       } else {
  //         memoryFS.set(path, v);
  //       }
  //     },
  //     end() {},
  //     bytesWritten: 0
  //   };
  // };
  // exports.createReadStream = path => {
  //   //TODO Accurate with md5?
  //   return contentstream(exports.readFileSync(path));
  // };
} else {
  module.exports = require('fs');
}
