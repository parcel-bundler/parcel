import {isArray} from 'lodash';
import {findIndex} from 'lodash';

export function checkIsList(list) {
  return isArray(list);
}

export function hasItem(list, item) {
  return findIndex(list, x => x === item) !== -1;
}
