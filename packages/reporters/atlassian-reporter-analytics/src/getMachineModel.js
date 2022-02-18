// @flow strict-local

// flowlint-next-line untyped-import:off
import execa from 'execa';

export default async function getMachineModel(): Promise<?string> {
  // For Mac, otherwise throws
  try {
    const {stdout, stderr} = await execa('system_profiler', [
      '-json',
      'SPHardwareDataType',
    ]);
    if (!stderr) {
      return JSON.parse(stdout).SPHardwareDataType[0].machine_model;
    }
  } catch (e) {
    // Return undefined
  }
}
