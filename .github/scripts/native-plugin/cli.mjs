import {execSync} from 'node:child_process';

/**
 * Runs `npm pack` and returns the single tarball it produced.
 *
 * Goes through a shell because npm is a `.cmd` on Windows, which Node refuses to
 * spawn directly. Arguments are quoted so paths with spaces survive both cmd.exe
 * and sh.
 */
export function npmPack(cwd, destination) {
  let command = ['npm', 'pack', '--json', '--pack-destination', destination]
    .map(arg => `"${arg}"`)
    .join(' ');

  let output = execSync(command, {
    cwd,
    encoding: 'utf8',
    // npm's notices go to stderr, and are worth keeping in the build log.
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  let packed;
  try {
    packed = JSON.parse(output);
  } catch {
    throw new Error(`Could not parse the output of npm pack: ${output}`);
  }

  if (!Array.isArray(packed) || packed.length !== 1) {
    throw new Error(
      `Expected npm pack to produce exactly one tarball, got: ${output}`,
    );
  }

  return packed[0];
}

/**
 * Reports a failure as a readable message plus a GitHub Actions annotation,
 * instead of a stack trace through the packaging scripts. Every error these
 * scripts throw is meant for a plugin author, not for whoever maintains them.
 */
export function reportErrors() {
  let report = error => {
    let message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.error(
      `::error::${message
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A')}`,
    );
    process.exit(1);
  };

  process.on('uncaughtException', report);
  process.on('unhandledRejection', report);
}
