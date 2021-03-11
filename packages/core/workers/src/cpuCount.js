// @flow
import os from 'os';

let cachedCoreCount = 0;
const platform = os.platform();
export function getCoreCount(
  limit: number = platform === 'win32' ? 4 : 8,
): number {
  if (!cachedCoreCount) {
    cachedCoreCount = Math.ceil(os.cpus().length / 2);
  }

  return Math.max(Math.min(cachedCoreCount, limit), 1);
}
