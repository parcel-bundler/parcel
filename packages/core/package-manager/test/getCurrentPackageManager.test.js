// @flow
import assert from 'assert';
import {Npm} from '../src/Npm';
import {Yarn} from '../src/Yarn';
import {Pnpm} from '../src/Pnpm.js';
import {execSync} from 'child_process';
import getCurrentPackageManager from '../src/getCurrentPackageManager';

const pmlist = [
  {
    pm: 'npm',
    installer: Npm,
  },
  {
    pm: 'yarn',
    installer: Yarn,
  },
  {
    pm: 'pnpm',
    installer: Pnpm,
  },
];

describe('getCurrentPackageManager', () => {
  for (const {pm, installer} of pmlist) {
    it(pm, async () => {
      const exists = installer.exists ? await installer.exists() : true;
      if (exists) {
        delete process.env.npm_config_user_agent;
        const res = execSync(`${pm} -s run log:agent`, {
          stdio: 'pipe',
        }).toString();
        const data = getCurrentPackageManager(res);
        assert(data.name, pm);
      }
    });
  }
});
