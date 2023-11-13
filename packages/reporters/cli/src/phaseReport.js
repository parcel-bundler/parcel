// @flow
import {prettifyTime} from '@parcel/utils';
import chalk from 'chalk';
import {writeOut} from './render';
import invariant from 'assert';

export default function phaseReport(phaseStartTimes: {[string]: number}) {
  let phaseTimes = {};
  if (phaseStartTimes['transforming'] && phaseStartTimes['bundling']) {
    phaseTimes['Transforming'] =
      phaseStartTimes['bundling'] - phaseStartTimes['transforming'];
  }

  let packagingAndOptimizing =
    phaseStartTimes['packaging'] && phaseStartTimes['optimizing']
      ? Math.min(phaseStartTimes['packaging'], phaseStartTimes['optimizing'])
      : phaseStartTimes['packaging'] || phaseStartTimes['optimizing'];

  if (phaseStartTimes['bundling'] && packagingAndOptimizing) {
    phaseTimes['Bundling'] =
      packagingAndOptimizing - phaseStartTimes['bundling'];
  }

  if (packagingAndOptimizing && phaseStartTimes['buildSuccess']) {
    phaseTimes['Packaging & Optimizing'] =
      phaseStartTimes['buildSuccess'] - packagingAndOptimizing;
  }

  for (let [phase, time] of Object.entries(phaseTimes)) {
    invariant(typeof time === 'number');
    writeOut(chalk.green.bold(`${phase} finished in ${prettifyTime(time)}`));
  }
}
