import assert from 'assert';

import codeframe from '../src/codeframe';

const LINE_END = '\n';

describe('codeframe', () => {
  it('should create a codeframe', () => {
    let codeframeString = codeframe(
      'hello world',
      [
        {
          start: {
            column: 1,
            line: 1
          },
          end: {
            column: 1,
            line: 1
          }
        },
        {
          start: {
            column: 3,
            line: 1
          },
          end: {
            column: 5,
            line: 1
          }
        }
      ],
      {useColor: false}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '> 1 | hello world');
    assert.equal(lines[1], '>   | ^ ^^^');
  });

  it('should create a codeframe with multiple lines', () => {
    let codeframeString = codeframe(
      'hello world\nEnjoy this nice codeframe',
      [
        {
          start: {
            column: 1,
            line: 1
          },
          end: {
            column: 1,
            line: 1
          }
        },
        {
          start: {
            column: 7,
            line: 1
          },
          end: {
            column: 10,
            line: 2
          }
        }
      ],
      {useColor: false}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '> 1 | hello world');
    assert.equal(lines[1], '>   | ^     ^^^^^');
    assert.equal(lines[2], '> 2 | Enjoy this nice codeframe');
    assert.equal(lines[3], '>   | ^^^^^^^^^^');
  });

  it('should handle unordered overlapping highlights properly', () => {
    let codeframeString = codeframe(
      'hello world\nEnjoy this nice codeframe',
      [
        {
          start: {
            column: 1,
            line: 1
          },
          end: {
            column: 1,
            line: 1
          }
        },
        {
          start: {
            column: 7,
            line: 1
          },
          end: {
            column: 10,
            line: 2
          }
        },
        {
          start: {
            column: 4,
            line: 2
          },
          end: {
            column: 7,
            line: 2
          }
        }
      ],
      {useColor: false}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '> 1 | hello world');
    assert.equal(lines[1], '>   | ^     ^^^^^');
    assert.equal(lines[2], '> 2 | Enjoy this nice codeframe');
    assert.equal(lines[3], '>   | ^^^^^^^^^^');
  });

  it('should handle partial overlapping highlights properly', () => {
    let codeframeString = codeframe(
      'hello world\nEnjoy this nice codeframe',
      [
        {
          start: {
            column: 1,
            line: 1
          },
          end: {
            column: 1,
            line: 1
          }
        },
        {
          start: {
            column: 7,
            line: 1
          },
          end: {
            column: 10,
            line: 2
          }
        },
        {
          start: {
            column: 4,
            line: 2
          },
          end: {
            column: 12,
            line: 2
          }
        }
      ],
      {useColor: false}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '> 1 | hello world');
    assert.equal(lines[1], '>   | ^     ^^^^^');
    assert.equal(lines[2], '> 2 | Enjoy this nice codeframe');
    assert.equal(lines[3], '>   | ^^^^^^^^^^^^');
  });

  it('should be able to render inline messages', () => {
    let codeframeString = codeframe(
      'hello world\nEnjoy this nice codeframe',
      [
        {
          start: {
            column: 1,
            line: 1
          },
          end: {
            column: 6,
            line: 1
          },
          message: 'test'
        }
      ],
      {useColor: false}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '> 1 | hello world');
    assert.equal(lines[1], '>   | ^^^^^^ test');
    assert.equal(lines[2], '  2 | Enjoy this nice codeframe');
  });

  it('should only render last inline message of a column', () => {
    let codeframeString = codeframe(
      'hello world\nEnjoy this nice codeframe',
      [
        {
          start: {
            column: 1,
            line: 1
          },
          end: {
            column: 3,
            line: 1
          },
          message: 'test'
        },
        {
          start: {
            column: 1,
            line: 1
          },
          end: {
            column: 6,
            line: 1
          },
          message: 'this should be printed'
        }
      ],
      {useColor: false}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '> 1 | hello world');
    assert.equal(lines[1], '>   | ^^^^^^ this should be printed');
    assert.equal(lines[2], '  2 | Enjoy this nice codeframe');
  });

  it('should only render last inline message of a column with space', () => {
    let codeframeString = codeframe(
      'hello world\nEnjoy this nice codeframe',
      [
        {
          start: {
            column: 1,
            line: 1
          },
          end: {
            column: 1,
            line: 1
          },
          message: 'test'
        },
        {
          start: {
            column: 3,
            line: 1
          },
          end: {
            column: 7,
            line: 1
          },
          message: 'this should be printed'
        }
      ],
      {useColor: false}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '> 1 | hello world');
    assert.equal(lines[1], '>   | ^ ^^^^^ this should be printed');
    assert.equal(lines[2], '  2 | Enjoy this nice codeframe');
  });

  it('should only render last inline message of a column with multiple lines and space', () => {
    let codeframeString = codeframe(
      'hello world\nEnjoy this nice codeframe\nThis is another line',
      [
        {
          start: {
            column: 1,
            line: 1
          },
          end: {
            column: 1,
            line: 1
          },
          message: 'test'
        },
        {
          start: {
            column: 3,
            line: 1
          },
          end: {
            column: 7,
            line: 1
          },
          message: 'this should be printed'
        },
        {
          start: {
            column: 3,
            line: 2
          },
          end: {
            column: 7,
            line: 3
          },
          message: 'message line 2'
        }
      ],
      {useColor: false}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '> 1 | hello world');
    assert.equal(lines[1], '>   | ^ ^^^^^ this should be printed');
    assert.equal(lines[2], '> 2 | Enjoy this nice codeframe');
    assert.equal(lines[3], '>   |   ^^^^^^^^^^^^^^^^^^^^^^^');
    assert.equal(lines[4], '> 3 | This is another line');
    assert.equal(lines[5], '>   | ^^^^^^^ message line 2');
  });

  it('should be able to render colors', () => {
    let codeframeString = codeframe(
      'hello world\nEnjoy this nice codeframe\nThis is another line',
      [
        {
          start: {
            column: 1,
            line: 1
          },
          end: {
            column: 1,
            line: 1
          },
          message: 'test'
        },
        {
          start: {
            column: 3,
            line: 1
          },
          end: {
            column: 7,
            line: 1
          },
          message: 'this should be printed'
        },
        {
          start: {
            column: 3,
            line: 2
          },
          end: {
            column: 7,
            line: 3
          },
          message: 'message line 2'
        }
      ],
      {useColor: true}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '\u001b[31m>\u001b[39m 1 | hello world');
    assert.equal(
      lines[1],
      '\u001b[31m>\u001b[39m   | \u001b[31m^\u001b[39m \u001b[31m^^^^^\u001b[39m this should be printed'
    );
    assert.equal(
      lines[2],
      '\u001b[31m>\u001b[39m 2 | Enjoy this nice codeframe'
    );
    assert.equal(
      lines[3],
      '\u001b[31m>\u001b[39m   |   \u001b[31m^^^^^^^^^^^^^^^^^^^^^^^\u001b[39m'
    );
    assert.equal(lines[4], '\u001b[31m>\u001b[39m 3 | This is another line');
    assert.equal(
      lines[5],
      '\u001b[31m>\u001b[39m   | \u001b[31m^^^^^^^\u001b[39m message line 2'
    );
  });
});
