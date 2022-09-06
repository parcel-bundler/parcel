import bar from './bar';
import foo from './foo';
require('./b.css');
export default Promise.all([foo, bar]);
