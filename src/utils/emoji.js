const supportsEmoji = process.platform !== 'win32' || process.env.VSCODE_PID;

// Fallback symbols for Windows from https://en.wikipedia.org/wiki/Code_page_437
exports.progress = supportsEmoji ? '⏳' : '∞';
exports.success = supportsEmoji ? '✨' : '√';
exports.error = supportsEmoji ? '🚨' : '×';
