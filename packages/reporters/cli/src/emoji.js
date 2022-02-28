// @flow strict-local

// From https://github.com/sindresorhus/is-unicode-supported/blob/8f123916d5c25a87c4f966dcc248b7ca5df2b4ca/index.js
// This package is ESM-only so it has to be vendored
function isUnicodeSupported() {
  if (process.platform !== 'win32') {
    return process.env.TERM !== 'linux'; // Linux console (kernel)
  }

  return (
    Boolean(process.env.CI) ||
    Boolean(process.env.WT_SESSION) || // Windows Terminal
    process.env.ConEmuTask === '{cmd::Cmder}' || // ConEmu and cmder
    process.env.TERM_PROGRAM === 'vscode' ||
    process.env.TERM === 'xterm-256color' ||
    process.env.TERM === 'alacritty'
  );
}

const supportsEmoji = isUnicodeSupported();

// Fallback symbols for Windows from https://en.wikipedia.org/wiki/Code_page_437
export const progress: string = supportsEmoji ? '⏳' : '∞';
export const success: string = supportsEmoji ? '✨' : '√';
export const error: string = supportsEmoji ? '🚨' : '×';
export const warning: string = supportsEmoji ? '⚠️' : '‼';
export const info: string = supportsEmoji ? 'ℹ️' : 'ℹ';
export const hint: string = supportsEmoji ? '💡' : 'ℹ';
export const docs: string = supportsEmoji ? '📝' : 'ℹ';
