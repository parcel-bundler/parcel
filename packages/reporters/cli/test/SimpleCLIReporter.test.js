// @flow strict-local

import assert from 'assert';
import {PassThrough} from 'stream';
import {_report, _setStdio} from '../src/SimpleCLIReporter';

const EMPTY_OPTIONS = {
  cacheDir: '.parcel-cache',
  entries: [],
  logLevel: 'info',
  rootDir: __dirname,
  targets: []
};

describe('SimpleCLIReporter', () => {
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

    _report({type: 'log', level: 'info', message: 'info'}, options);
    _report({type: 'log', level: 'success', message: 'success'}, options);
    _report({type: 'log', level: 'verbose', message: 'verbose'}, options);

    assert.equal(stdoutOutput, 'info\nsuccess\nverbose\n');
  });

  it('writes errors and warnings to stderr', () => {
    _report({type: 'log', level: 'error', message: 'error'}, EMPTY_OPTIONS);
    _report({type: 'log', level: 'warn', message: 'warn'}, EMPTY_OPTIONS);

    assert.equal(stdoutOutput, '');
    assert.equal(stderrOutput, 'parcel: error\nparcel: warn\n');
  });

  it('prints errors nicely', () => {
    _report(
      {type: 'log', level: 'error', message: new Error('error')},
      EMPTY_OPTIONS
    );
    _report(
      {type: 'log', level: 'warn', message: new Error('warn')},
      EMPTY_OPTIONS
    );

    assert.equal(stdoutOutput, '');
    assert(stderrOutput.includes('parcel: error\n'));
    assert(stderrOutput.includes('parcel: warn\n'));
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
