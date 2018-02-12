const supportsEmoji =
  process.platform !== 'win32' || process.env.TERM === 'xterm-256color';

// Fallback symbols for Windows from https://en.wikipedia.org/wiki/Code_page_437
exports.progress = supportsEmoji ? '⏳' : '∞';
exports.success = supportsEmoji ? '✨' : '√';
exports.error = supportsEmoji ? '🚨' : '×';
exports.warning = supportsEmoji ? '⚠️' : '‼';
