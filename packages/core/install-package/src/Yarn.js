// @flow strict-local

import type {FilePath} from '@parcel/types';

import commandExists from 'command-exists';
import spawn from 'cross-spawn';
import logger from '@parcel/logger';
import split from 'split2';

import JSONParseStream from './JSONParseStream';
import promiseFromProcess from './promiseFromProcess';

const YARN_CMD = 'yarn';

type YarnStdOutMessage =
  | {|
      +type: 'step',
      data: {|
        message: string,
        current: number,
        total: number
      |}
    |}
  | {|+type: 'success', data: string|}
  | {|+type: 'info', data: string|}
  | {+type: 'tree' | 'progressStart' | 'progressTick', ...};

type YarnStdErrMessage = {|
  +type: 'error' | 'warning',
  data: string
|};

let hasYarn: ?boolean;
export default class Yarn {
  cwd: FilePath;

  constructor({cwd}: {cwd: FilePath, ...}) {
    this.cwd = cwd;
  }

  static async exists(): Promise<boolean> {
    if (hasYarn != null) {
      return hasYarn;
    }

    try {
      hasYarn = Boolean(await commandExists('yarn'));
    } catch (err) {
      hasYarn = false;
    }

    return hasYarn;
  }

  async install(
    modules: Array<string>,
    saveDev: boolean = true
  ): Promise<void> {
    let args = ['add', '--json', ...modules];
    if (saveDev) {
      args.push('-D');
    }

    let installProcess = spawn(YARN_CMD, args, {cwd: this.cwd});
    installProcess.stdout
      // Invoking yarn with --json provides streaming, newline-delimited JSON output.
      .pipe(split())
      .pipe(new JSONParseStream())
      .on('error', e => {
        logger.error(e);
      })
      .on('data', (message: YarnStdOutMessage) => {
        switch (message.type) {
          case 'step':
            logger.progress(
              prefix(
                `[${message.data.current}/${message.data.total}] ${
                  message.data.message
                }`
              )
            );
            return;
          case 'success':
          case 'info':
            logger.info(prefix(message.data));
            return;
          default:
          // ignore
        }
      });

    installProcess.stderr
      .pipe(split())
      .pipe(new JSONParseStream())
      .on('error', e => {
        logger.error(e);
      })
      .on('data', (message: YarnStdErrMessage) => {
        switch (message.type) {
          case 'warning':
            logger.warn(prefix(message.data));
            return;
          case 'error':
            logger.error(prefix(message.data));
            return;
          default:
          // ignore
        }
      });

    try {
      return await promiseFromProcess(installProcess);
    } catch (e) {
      throw new Error('Yarn failed to install modules');
    }
  }
}

function prefix(message: string): string {
  return 'yarn: ' + message;
}
