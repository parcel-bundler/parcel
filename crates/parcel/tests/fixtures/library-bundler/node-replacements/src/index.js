import fs from 'fs';
import path from 'path';

// Reads a file next to this one at runtime, the way the dist of a macro library does.
export const data = fs.readFileSync(__dirname + '/data.txt', 'utf8');
export const dirname = path.basename(__dirname);
export const filename = path.basename(__filename);
