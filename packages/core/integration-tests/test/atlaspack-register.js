// @flow strict-local

import {execSync} from 'child_process';
import assert from 'assert';
import path from 'path';

describe.skip('@atlaspack/register', () => {
  it('can be required at an entry script and transform following requires', () => {
    assert.equal(
      execSync(
        `node ${path.join(
          __dirname,
          'integration',
          'atlaspack-register',
          'entry.js',
        )}`,
      ),
      '123',
    );
  });

  it('can transform with --r and --require', () => {
    assert.equal(
      execSync(
        `node -r @atlaspack/register ${path.join(
          __dirname,
          'integration',
          'atlaspack-register',
          'index.js',
        )}`,
      ),
      '123',
    );
  });

  it("enables Atlaspack's resolver in node", () => {
    let [foo, resolved] = execSync(
      `node -r @atlaspack/register ${path.join(
        __dirname,
        'integration',
        'atlaspack-register',
        'resolver.js',
      )}`,
      {cwd: path.join(__dirname, 'integration', 'atlaspack-register')},
    )
      .toString()
      .split('\n');
    assert.equal(foo, 'foo');
    assert.equal(
      resolved,
      path.join(__dirname, 'integration', 'atlaspack-register', 'foo.js'),
    );
  });

  it('can be disposed of, which reverts resolving', () => {
    try {
      execSync(
        `node ${path.join(
          __dirname,
          'integration',
          'atlaspack-register',
          'dispose-resolve.js',
        )}`,
        {
          cwd: path.join(__dirname, 'integration', 'atlaspack-register'),
          stdio: 'pipe',
        },
      )
        .toString()
        .split('\n');
    } catch (e) {
      assert.equal(
        e.stdout.toString().trim(),
        path.join(__dirname, 'integration', 'atlaspack-register', 'foo.js'),
      );
      assert(e.stderr.includes("Error: Cannot find module '~foo.js'"));
      return;
    }

    // $FlowFixMe
    assert.fail();
  });

  it('can be disposed of, which reverts transforming', () => {
    try {
      execSync(
        `node ${path.join(
          __dirname,
          'integration',
          'atlaspack-register',
          'dispose-transform.js',
        )}`,
        {
          cwd: path.join(__dirname, 'integration', 'atlaspack-register'),
          stdio: 'pipe',
        },
      )
        .toString()
        .split('\n');
    } catch (e) {
      assert.equal(e.stdout.toString().trim(), '123');
      assert(e.stderr.includes('SyntaxError: Unexpected identifier'));
      return;
    }

    // $FlowFixMe
    assert.fail();
  });
});
