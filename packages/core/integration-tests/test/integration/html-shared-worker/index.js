import _ from 'lodash';

output("main", _.add(1, 2));

new Worker(new URL('worker.js', import.meta.url), {type: 'module'});
