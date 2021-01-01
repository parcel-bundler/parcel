import fs from 'fs';
import normalizeNewline from 'normalize-newline';

export function readFile(filePath) {
  return normalizeNewline(fs.readFileSync(filePath, 'utf8'));
}
