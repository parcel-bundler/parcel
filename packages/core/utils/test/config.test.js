// @flow strict-local

import assert from 'assert';
import {loadConfig} from '../src/config';
import {inputFS as fs} from '@parcel/test-utils';
import path from 'path';

describe('loadConfig', () => {
  it('load config with json', async () => {
    assert.deepEqual(
      (
        await loadConfig(
          fs,
          path.join(__dirname, './input/config/config.json'),
          ['config.json'],
          path.join(__dirname, './input/config/'),
        )
      )?.config,
      {
        hoge: 'fuga',
      },
    );
  });

  it('should throw error with empty string json', async () => {
    // $FlowFixMe[prop-missing]
    await assert.rejects(async () => {
      await loadConfig(
        fs,
        path.join(__dirname, './input/config/empty.json'),
        ['empty.json'],
        path.join(__dirname, './input/config/'),
      );
    });
  });

  it('should load with empty string config toml', async () => {
    assert.deepEqual(
      (
        await loadConfig(
          fs,
          path.join(__dirname, './input/config/empty.toml'),
          ['empty.toml'],
          path.join(__dirname, './input/config/'),
        )
      )?.config,
      {},
    );
  });
});
