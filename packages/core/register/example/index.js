require('@parcel/register');

const count = require('./count.js');
const number = require('./number.js');
const something = require('something');

const numberOne = number();
const numberTwo = number();

/* eslint-disable no-console */
console.log(`${numberOne} + ${numberTwo} =`, count(numberOne, numberTwo));
console.log(something());
/* eslint-enable */
