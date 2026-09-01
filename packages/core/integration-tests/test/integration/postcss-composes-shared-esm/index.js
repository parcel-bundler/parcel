import * as a from './a.module.css';
import * as b from './b.module.css';

module.exports = function () {
  return a.primary + ' ' + b.container;
};
