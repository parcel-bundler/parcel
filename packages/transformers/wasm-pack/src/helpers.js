// @flow

import {spawn} from 'child_process';

import logger from '@parcel/logger';

const createAggregator = () => ({
  currentLine: '',
  allLines: '',
});

const logProgress = (line: string) => {
  const lines: string[] = line.split('\n');
  lines.slice(0, -1).forEach(l => logger.progress(l));
  return lines.slice(-1)[0];
};

const createOnData = aggregator => data => {
  aggregator.currentLine += data;
  if (aggregator.currentLine.includes('\n')) {
    aggregator.allLines += aggregator.currentLine;
    aggregator.currentLine = logProgress(aggregator.currentLine);
  }
};

export const spawnProcess = (
  command: string,
  args: string[],
  options?: child_process$spawnOpts,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const process = spawn(command, args, options);

    const stdout = createAggregator();
    const stderr = createAggregator();

    process.stdout.on('data', createOnData(stdout));
    process.stderr.on('data', createOnData(stderr));

    process
      .on('close', code => {
        logger.progress('');
        code === 0
          ? resolve(stdout.allLines + stdout.currentLine)
          : reject(stderr.allLines + stderr.currentLine);
      })
      .on('error', error => {
        logger.progress('');
        reject(error);
      });
  });
