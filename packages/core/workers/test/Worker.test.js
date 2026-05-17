import assert from 'assert';

import Worker from '../src/Worker';

const PROCESS_WORKER_PATH = require.resolve('../src/process/ProcessWorker');

// Stub the ProcessWorker backend so we can capture the execArgv that Worker.fork()
// passes to it, without spawning a real child process. The backend's start() is
// rejected so fork() bails out fast after the constructor runs.
function installBackendStub() {
  let captured = {args: null};
  let previous = require.cache[PROCESS_WORKER_PATH];

  class FakeBackend {
    constructor(execArgv) {
      captured.args = execArgv;
    }
    start() {
      return Promise.reject(new Error('halt — backend stubbed by test'));
    }
    stop() {
      return Promise.resolve();
    }
    send() {}
  }

  require.cache[PROCESS_WORKER_PATH] = {
    id: PROCESS_WORKER_PATH,
    filename: PROCESS_WORKER_PATH,
    loaded: true,
    children: [],
    paths: [],
    exports: {__esModule: true, default: FakeBackend},
  };

  return {
    captured,
    restore() {
      if (previous) {
        require.cache[PROCESS_WORKER_PATH] = previous;
      } else {
        delete require.cache[PROCESS_WORKER_PATH];
      }
    },
  };
}

async function getFilteredArgs(execArgv) {
  let originalExecArgv = process.execArgv;
  let originalNodeOptions = process.env.NODE_OPTIONS;
  let stub = installBackendStub();
  process.execArgv = execArgv;
  delete process.env.NODE_OPTIONS;
  try {
    let worker = new Worker({
      forcedKillTime: 100,
      backend: 'process',
      sharedReferences: new Map(),
    });
    await assert.rejects(() => worker.fork(__filename));
    return stub.captured.args;
  } finally {
    process.execArgv = originalExecArgv;
    if (originalNodeOptions === undefined) {
      delete process.env.NODE_OPTIONS;
    } else {
      process.env.NODE_OPTIONS = originalNodeOptions;
    }
    stub.restore();
  }
}

describe('Worker.fork execArgv filtering', () => {
  it('strips debugger and inspector flags', async () => {
    assert.deepStrictEqual(
      await getFilteredArgs([
        '--inspect',
        '--inspect-brk',
        '--inspect=0.0.0.0:9229',
        '--debug',
        '--debug-brk',
      ]),
      [],
    );
  });

  it('strips V8 tuning flags', async () => {
    assert.deepStrictEqual(
      await getFilteredArgs([
        '--no-opt',
        '--max-old-space-size=4096',
        '--max-semi-space-size=64',
        '--expose-gc',
      ]),
      [],
    );
  });

  it('strips flags that crashed workers on node 24.7.0+', async () => {
    assert.deepStrictEqual(
      await getFilteredArgs([
        '--tls-cipher-list=HIGH',
        '--v8-pool-size=4',
        '--trace-event-file-pattern=trace-${pid}.log',
        '--secure-heap=8192',
        '--secure-heap-min=4096',
        '--node-snapshot',
        '--use-largepages=on',
        '--stack-trace-limit=20',
      ]),
      [],
    );
  });

  it('strips -r @parcel/register and --title together with their values', async () => {
    assert.deepStrictEqual(
      await getFilteredArgs([
        '-r',
        '@parcel/register',
        '--require',
        '@parcel/register',
        '--title',
        'parcel-worker',
      ]),
      [],
    );
  });

  it('keeps -r/--require when the value is not @parcel/register', async () => {
    assert.deepStrictEqual(
      await getFilteredArgs([
        '-r',
        'ts-node/register',
        '--require',
        'dotenv/config',
      ]),
      ['-r', 'ts-node/register', '--require', 'dotenv/config'],
    );
  });

  it('keeps unrelated flags', async () => {
    let argv = ['--enable-source-maps', '--experimental-vm-modules'];
    assert.deepStrictEqual(await getFilteredArgs(argv), argv);
  });

  it('handles a mix of excluded and preserved flags', async () => {
    assert.deepStrictEqual(
      await getFilteredArgs([
        '--enable-source-maps',
        '--max-old-space-size=4096',
        '--stack-trace-limit=20',
        '-r',
        '@parcel/register',
        '--experimental-vm-modules',
        '--title',
        'parcel-worker',
      ]),
      ['--enable-source-maps', '--experimental-vm-modules'],
    );
  });
});
