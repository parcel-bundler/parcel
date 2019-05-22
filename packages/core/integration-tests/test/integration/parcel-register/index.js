// @flow

import type {Writable} from 'stream';

function echo(...messages: Array<mixed>): void {
  let stdout: Writable = process.stdout;
  for (let message of messages) {
    stdout.write(String(message))
  }
}

echo(1, 2, 3);
