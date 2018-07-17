import shared from './shared';

module.exports = import('./b').then(b => b.out + shared);
