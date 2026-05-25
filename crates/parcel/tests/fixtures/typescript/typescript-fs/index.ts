import { readFileSync } from 'fs';
import rawFromTsx from './readFromTsx';

output = {
  fromTs: readFileSync(__dirname + '/raw.tsx', 'utf-8'),
  fromTsx: rawFromTsx,
};
