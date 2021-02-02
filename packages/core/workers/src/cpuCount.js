// @flow
import os from 'os';

export function getCoreCount(limit: number = 8): number {
  let coreCount = Math.ceil(os.cpus().length / 2);
  return Math.max(Math.min(coreCount, limit), 1);
}
