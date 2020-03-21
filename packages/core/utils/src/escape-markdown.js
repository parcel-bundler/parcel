// @flow
const escapeCharacters = ['\\', '*', '_', '~'];

export function escapeMarkdown(s: string): string {
  for (const char of escapeCharacters) {
    s = s.replace(new RegExp(`\\${char}`, 'g'), `\\${char}`);
  }

  return s;
}
