import {isArray} from 'lodash';
import {findIndex} from 'lodash';

class ListChecker {
  checkIsList(list) {
    return isArray(list);
  }
  hasItem(list, item) {
    return findIndex(list, x => x === item) !== -1;
  }
}

export default ListChecker;
