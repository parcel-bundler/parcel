// @flow
import assert from 'assert';
import {Yarn} from '../src/Yarn';
import {Pnpm} from '../src/Pnpm.js';
import {execSync} from 'child_process';
import getCurrentPackageManager from '../src/getCurrentPackageManager';

const pmlist: Array<{exists: () => Promise<boolean>, pm: string, ...}> = [
  {
    pm: 'npm',
    exists: () => Promise.resolve(true),
  },
  {
    pm: 'yarn',
    exists: () => Yarn.exists(),
  },
  {
    pm: 'pnpm',
    exists: () => Pnpm.exists(),
  },
];

describe('getCurrentPackageManager', () => {
  it('yarn', () => {
    const npm_config_user_agent = 'yarn/1.22.21 npm/? node/v21.1.0 darwin x64';
    const currentPackageManager = getCurrentPackageManager(
      npm_config_user_agent,
    );
    assert(currentPackageManager?.name, 'yarn');
  });
  it('npm', () => {
    const npm_config_user_agent =
      'npm/10.2.0 node/v21.1.0 darwin x64 workspaces/true';
    const currentPackageManager = getCurrentPackageManager(
      npm_config_user_agent,
    );
    assert(currentPackageManager?.name, 'npm');
  });
  it('pnpm', () => {
    const npm_config_user_agent = 'pnpm/8.14.2 npm/? node/v18.17.1 darwin x64';
    const currentPackageManager = getCurrentPackageManager(
      npm_config_user_agent,
    );
    assert(currentPackageManager?.name, 'pnpm');
  });
});
