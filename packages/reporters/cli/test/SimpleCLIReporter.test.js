// @flow strict-local

import assert from 'assert';
import {PassThrough} from 'stream';
import {_report, _setStdio} from '../src/SimpleCLIReporter';
import {inputFS, outputFS} from '@parcel/test-utils';
import {NodePackageManager} from '@parcel/package-manager';

const EMPTY_OPTIONS = {
  cacheDir: '.parcel-cache',
  entries: [],
  logLevel: 'info',
  rootDir: __dirname,
  targets: [],
  projectRoot: '',
  lockFile: undefined,
  autoinstall: false,
  hot: false,
  serve: false,
  mode: 'development',
  scopeHoist: false,
  minify: false,
  env: {},
  disableCache: false,
  sourceMaps: false,
  inputFS,
  outputFS,
  packageManager: new NodePackageManager(inputFS)
};

describe('SimpleCLIReporter', () => {
  // $FlowFixMe only run in CI
  if (process.stdout.isTTY) {
    return;
  }

  let originalStdout;
  let originalStderr;
  let stdoutOutput;
  let stderrOutput;

  beforeEach(() => {
    // Stub these out to avoid writing noise to real stdio and to read from these
    // otherwise only writable streams
    originalStdout = process.stdout;
    originalStderr = process.stderr;

    stdoutOutput = '';
    stderrOutput = '';

    let mockStdout = new PassThrough();
    mockStdout.on('data', d => (stdoutOutput += d.toString()));
    let mockStderr = new PassThrough();
    mockStderr.on('data', d => (stderrOutput += d.toString()));
    _setStdio(mockStdout, mockStderr);
  });

  afterEach(() => {
    _setStdio(originalStdout, originalStderr);
  });

  it('writes log, info, success, and verbose log messages to stdout', () => {
    let options = {
      ...EMPTY_OPTIONS,
      logLevel: 'verbose'
    };

    _report(
      {
        type: 'log',
        level: 'info',
        diagnostics: [
          {
            origin: 'test',
            message: 'info'
          }
        ]
      },
      options
    );
    _report({type: 'log', level: 'success', message: 'success'}, options);
    _report(
      {
        type: 'log',
        level: 'verbose',
        diagnostics: [
          {
            origin: 'test',
            message: 'verbose'
          }
        ]
      },
      options
    );

    assert.equal(stdoutOutput, 'test: info\nsuccess\ntest: verbose\n');
  });

  it('writes errors and warnings to stderr', () => {
    _report(
      {
        type: 'log',
        level: 'error',
        diagnostics: [
          {
            origin: 'test',
            message: 'error'
          }
        ]
      },
      EMPTY_OPTIONS
    );
    _report(
      {
        type: 'log',
        level: 'warn',
        diagnostics: [
          {
            origin: 'test',
            message: 'warn'
          }
        ]
      },
      EMPTY_OPTIONS
    );

    assert.equal(stdoutOutput, '');
    assert.equal(stderrOutput, 'test: error\ntest: warn\n');
  });

  it('prints errors nicely', () => {
    _report(
      {
        type: 'log',
        level: 'error',
        diagnostics: [
          {
            origin: 'test',
            message: 'error'
          }
        ]
      },
      EMPTY_OPTIONS
    );
    _report(
      {
        type: 'log',
        level: 'warn',
        diagnostics: [
          {
            origin: 'test',
            message: 'warn'
          }
        ]
      },
      EMPTY_OPTIONS
    );

    assert.equal(stdoutOutput, '');
    assert(stderrOutput.includes('test: error\n'));
    assert(stderrOutput.includes('test: warn\n'));
  });

  it('writes buildProgress messages to stdout on the default loglevel', () => {
    _report({type: 'buildProgress', phase: 'bundling'}, EMPTY_OPTIONS);
    assert.equal(stdoutOutput, 'Bundling...\n');
  });

  it('writes buildSuccess messages to stdout on the default loglevel', () => {
    _report({type: 'buildProgress', phase: 'bundling'}, EMPTY_OPTIONS);
    assert.equal(stdoutOutput, 'Bundling...\n');
  });
});
