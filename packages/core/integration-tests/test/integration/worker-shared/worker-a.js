import _ from 'lodash'

console.log(_);
new Worker(new URL('worker-b.js', import.meta.url), {type: 'module'})
