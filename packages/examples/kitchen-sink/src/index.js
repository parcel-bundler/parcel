import styles from './styles.css';
import parcel from 'url:./parcel.webp';
import parcelFront from 'webp:./parcel-front.png';
import {message} from './message';

// import('./async');
// import('./async2');

new Worker('worker.js');

console.log({parcelFront});
console.log(message);

// const message = require('./message');
// const fs = require('fs');

// console.log(message); // eslint-disable-line no-console
// console.log(fs.readFileSync(__dirname + '/test.txt', 'utf8'));

// class Test {}
