import { readFileSync } from 'fs';
import rawFromTsx from './readFromTsx';

module.exports = {
  fromTs: readFileSync(__dirname + '/raw.tsx', "utf-8"),
  fromTsx: rawFromTsx,
};
