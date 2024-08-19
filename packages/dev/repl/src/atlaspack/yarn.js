// @flow
import type {REPLOptions} from '../utils';
import type {MemoryFS} from '@atlaspack/fs';
import {openDB} from 'idb';
import {Buffer} from 'buffer';

// $FlowFixMe
import {run} from '@mischnic/yarn-browser';

let previousDependencies: ?$PropertyType<REPLOptions, 'dependencies'>;
function shouldRunYarn(
  oldDeps: ?$PropertyType<REPLOptions, 'dependencies'>,
  newDeps: $PropertyType<REPLOptions, 'dependencies'>,
) {
  if (oldDeps) {
    if (oldDeps.length !== newDeps.length) return true;
    else if (newDeps.length === 0) return false;
    for (let i = 0; i < newDeps.length; i++) {
      let [nameOld, versionOld] = oldDeps[i];
      let [nameNew, versionNew] = newDeps[i];
      if (nameOld !== nameNew || versionOld !== versionNew) {
        return true;
      }
    }
    return false;
  } else {
    return newDeps.length > 0;
  }
}

export async function yarnInstall(
  options: REPLOptions,
  fs: MemoryFS,
  dir: string,
  progress: ({|
    type: string,
    displayName: string,
    indent: string,
    data: string,
  |}) => void,
) {
  let dependencies = options.dependencies;
  if (await fs.exists('/app/package.json')) {
    let pkg = await fs.readFile('/app/package.json', 'utf8');
    let deps = JSON.parse(pkg).dependencies;
    if (deps) {
      // $FlowFixMe
      dependencies = (Object.entries(deps): Array<[string, string]>);
    }
  }

  if (shouldRunYarn(previousDependencies, dependencies)) {
    // $FlowFixMe
    // const {run: yarnInstall} = await import('@mischnic/yarn-browser');
    await fs.mkdirp('/tmp');
    await Cache.restoreLockfile(fs);
    await Cache.restoreCache(fs);
    let {report} = await run({
      dir,
      fs,
      options: {npmRegistryServer: 'registry.npmjs.org'},
      progress(v) {
        let {type, indent, data, displayName} = v;
        console.debug(
          `%c[${displayName}] ${indent} ${data}`,
          `font-family: monospace;${type === 'error' ? 'color: red;' : ''}`,
        );
        progress(v);
      },
    });
    if (report.errorCount > 0) {
      throw [...report.reportedErrors][0] ?? new Error('Yarn install failed');
    }
    console.debug(report);
    await Cache.saveLockfile(fs);
    await Cache.saveCache(fs);
  }

  previousDependencies = dependencies;
}

const IDB_DB_YARN = 'REPL-yarn-cache';
const IDB_STORE_CACHE = 'cache';
const IDB_STORE_LOCK = 'lockfile';
const IDB_CACHE_VERSION = 1;

function getDB() {
  return openDB(IDB_DB_YARN, IDB_CACHE_VERSION, {
    upgrade(db) {
      let cache = db.createObjectStore(IDB_STORE_CACHE, {
        keyPath: 'name',
      });
      cache.createIndex('lastUsed', 'lastUsed', {unique: false});

      db.createObjectStore(IDB_STORE_LOCK, {
        keyPath: 'name',
      });
    },
    blocked() {},
    blocking() {},
    terminated() {},
  });
}

const YARN_CACHE_DIR = '/app/.yarn/cache';
const YARN_LOCKFILE = '/app/yarn.lock';
// const YARN_CACHE_STALE = /* 7 Days: */ 7 * 24 * 60 * 60 * 1000;
const Cache = {
  async saveCache(fs: MemoryFS) {
    const files = (await fs.readdir(YARN_CACHE_DIR)).map(name => [
      name,
      fs.readFileSync(YARN_CACHE_DIR + '/' + name),
    ]);

    const db = await getDB();
    let time = Date.now();
    await db.clear(IDB_STORE_CACHE);
    {
      const tx = db.transaction(IDB_STORE_CACHE, 'readwrite');
      // await tx.store.clear();
      await Promise.all([
        ...files.map(([name, data]) =>
          tx.store.put({
            name,
            lastUsed: time,
            data,
          }),
        ),
        tx.done,
      ]);
    }
    // {
    //   const tx = db.transaction(IDB_STORE_CACHE, 'readwrite');
    //   let oldEntries = await (await tx.store.index('lastUsed')).getAll(
    //     // $FlowFixMe
    //     IDBKeyRange.upperBound(time - YARN_CACHE_STALE),
    //   );
    //   if (oldEntries.length > 0) {
    //     console.log(`Purging cache, deleting ${oldEntries.length} packages`);
    //   }
    //   await Promise.all([
    //     ...oldEntries.map(({name}) => tx.store.delete(name)),
    //     tx.done,
    //   ]);
    // }
  },
  async restoreCache(fs: MemoryFS) {
    await fs.mkdirp(YARN_CACHE_DIR);
    const db = await getDB();
    for (let {name, data} of await db.getAll(IDB_STORE_CACHE)) {
      console.debug('Restored from Yarn cache:', YARN_CACHE_DIR + '/' + name);
      await fs.writeFile(YARN_CACHE_DIR + '/' + name, Buffer.from(data));
    }
  },

  async saveLockfile(fs: MemoryFS) {
    const data = await fs.readFile(YARN_LOCKFILE);

    const db = await getDB();
    await db.put(IDB_STORE_LOCK, {
      name: 'yarn.lock',
      data,
    });
  },
  async restoreLockfile(fs: MemoryFS) {
    const db = await getDB();
    const result = await db.get(IDB_STORE_LOCK, 'yarn.lock');
    if (result) {
      await fs.writeFile(YARN_LOCKFILE, Buffer.from(result.data));
    }
  },
};
