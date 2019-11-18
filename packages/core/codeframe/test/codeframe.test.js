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

  it('should properly use padding', () => {
    let codeframeString = codeframe(
      'test\n'.repeat(100),
      [
        {
          start: {
            column: 2,
            line: 5
          },
          end: {
            column: 2,
            line: 5
          },
          message: 'test'
        }
      ],
      {
        useColor: false,
        padding: {
          before: 2,
          after: 4
        }
      }
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines.length, 8);
    assert.equal(lines[0], '  3 | test');
    assert.equal(lines[2], '> 5 | test');
    assert.equal(lines[3], '>   |  ^ test');
    assert.equal(lines[7], '  9 | test');
  });

  it('should properly pad numbers', () => {
    let codeframeString = codeframe('test\n'.repeat(1000), [
      {
        start: {
          column: 2,
          line: 99
        },
        end: {
          column: 2,
          line: 99
        },
        message: 'test'
      },
      {
        start: {
          column: 2,
          line: 100
        },
        end: {
          column: 2,
          line: 100
        },
        message: 'test'
      }
    ]);

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines.length, 7);
    assert.equal(lines[0], '  98  | test');
    assert.equal(lines[6], '  102 | test');
  });

  it('should properly pad numbers', () => {
    let codeframeString = codeframe('test\n'.repeat(1000), [
      {
        start: {
          column: 2,
          line: 7
        },
        end: {
          column: 2,
          line: 7
        },
        message: 'test'
      },
      {
        start: {
          column: 2,
          line: 12
        },
        end: {
          column: 2,
          line: 12
        },
        message: 'test'
      }
    ]);

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines.length, 11);
    assert.equal(lines[0], '  6  | test');
    assert.equal(lines[10], '  14 | test');
  });

  it('should properly use maxLines', () => {
    let codeframeString = codeframe(
      'test\n'.repeat(100),
      [
        {
          start: {
            column: 2,
            line: 5
          },
          end: {
            column: 2,
            line: 5
          },
          message: 'test'
        },
        {
          start: {
            column: 2,
            line: 12
          },
          end: {
            column: 2,
            line: 20
          },
          message: 'test'
        }
      ],
      {
        useColor: false,
        maxLines: 10
      }
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines.length, 13);
    assert.equal(lines[0], '  4  | test');
    assert.equal(lines[11], '> 13 | test');
    assert.equal(lines[12], '>    | ^^^^');
  });

  it('should be able to handle tabs', () => {
    let codeframeString = codeframe(
      'hel\tlo wor\tld\nEnjoy thi\ts nice cod\teframe',
      [
        {
          start: {
            column: 5,
            line: 1
          },
          end: {
            column: 7,
            line: 1
          },
          message: 'test'
        }
      ],
      {useColor: false}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '> 1 | hel  lo wor  ld');
    assert.equal(lines[1], '>   |      ^^^ test');
    assert.equal(lines[2], '  2 | Enjoy thi  s nice cod  eframe');
  });

  it('should be able to handle tabs with multiple highlights', () => {
    let codeframeString = codeframe(
      'hel\tlo wor\tld\nEnjoy thi\ts nice cod\teframe',
      [
        {
          start: {
            column: 3,
            line: 1
          },
          end: {
            column: 5,
            line: 1
          },
          message: 'test'
        },
        {
          start: {
            column: 7,
            line: 1
          },
          end: {
            column: 8,
            line: 1
          },
          message: 'test'
        }
      ],
      {useColor: false}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '> 1 | hel  lo wor  ld');
    assert.equal(lines[1], '>   |   ^^^^ ^^ test');
    assert.equal(lines[2], '  2 | Enjoy thi  s nice cod  eframe');
  });

  it('multiline highlights with tabs', () => {
    let codeframeString = codeframe(
      'hel\tlo wor\tld\nEnjoy thi\ts nice cod\teframe\ntest',
      [
        {
          start: {
            column: 3,
            line: 1
          },
          end: {
            column: 2,
            line: 3
          },
          message: 'test'
        }
      ],
      {useColor: false}
    );

    let lines = codeframeString.split(LINE_END);
    assert.equal(lines[0], '> 1 | hel  lo wor  ld');
    assert.equal(lines[1], '>   |   ^^^^^^^^^^^^^');
    assert.equal(lines[2], '> 2 | Enjoy thi  s nice cod  eframe');
    assert.equal(lines[3], '>   | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^');
    assert.equal(lines[4], '> 3 | test');
    assert.equal(lines[5], '>   | ^^ test');
  });
});
