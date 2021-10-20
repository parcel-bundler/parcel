import {isArray} from 'lodash';

const Module = {
  name: 'Test Module',
  mount: () => console.log('mount', isArray([])),
  unmount: () => console.log('unmount', isArray([])),
};

export default Module;
