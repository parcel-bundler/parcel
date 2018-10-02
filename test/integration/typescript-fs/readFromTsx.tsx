import { readFileSync } from 'fs';

const raw = readFileSync(__dirname + '/raw.tsx', "utf-8");

export default raw;