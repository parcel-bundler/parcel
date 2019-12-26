// @flow strict-local

const supportsEmoji =
  process.platform !== 'win32' || process.env.TERM === 'xterm-256color';

// Fallback symbols for Windows from https://en.wikipedia.org/wiki/Code_page_437
export const progress = supportsEmoji ? '⏳' : '∞';
export const success = supportsEmoji ? '✨' : '√';
export const error = supportsEmoji ? '🚨' : '×';
export const warning = supportsEmoji ? '⚠️' : '‼';
export const info = supportsEmoji ? 'ℹ️' : 'ℹ';
export const hint = supportsEmoji ? '💡' : 'ℹ';
