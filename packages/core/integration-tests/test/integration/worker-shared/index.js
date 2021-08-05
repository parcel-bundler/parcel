import _ from 'lodash';

new Worker(new URL('worker-a.js', import.meta.url), {type: 'module'});
