import {platform} from 'process';

module.exports = platform === undefined ? 'browser' : platform;
