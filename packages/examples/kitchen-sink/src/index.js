import styles from './styles.css';
import atlaspack from 'url:./atlaspack.webp';
import {message} from './message';

import('./async');
import('./async2');

new Worker(new URL('worker.js', import.meta.url));

console.log(message);

// const message = require('./message');
// const fs = require('fs');

// console.log(message);
// console.log(fs.readFileSync(__dirname + '/test.txt', 'utf8'));

// class Test {}
