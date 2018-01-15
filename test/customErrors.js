const assert = require('assert');
const customErrors = require('../src/utils/customErrors');

const port = 1234;

const EACCES = new Error();
EACCES.code = 'EACCES';
const EADDRINUSE = new Error();
EADDRINUSE.code = 'EADDRINUSE';

describe('customErrors', () => {
  it('serverErrors should include port', () => {
    const msg = customErrors.serverErrors(EACCES, port);
    assert(msg.includes(port));
  });

  it('serverErrors should handle known errors', () => {
    let msg = customErrors.serverErrors(EACCES, port);
    assert(msg.includes(`don't have access`));

    msg = customErrors.serverErrors(EADDRINUSE, port);
    assert(msg.includes('already'));
  });

  it('serverErrors should handled unknown errors', () => {
    let msg = customErrors.serverErrors(new Error(), port);
    assert(msg.includes(port));
  });
});
