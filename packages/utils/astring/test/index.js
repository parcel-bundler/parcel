import fs from 'fs';
import path from 'path';
import {parse} from 'acorn';
import * as astravel from 'astravel';
import assert from 'assert';
import {parse as babelParse} from '@babel/parser';
import {generateAST} from '@parcel/babel-ast-utils';

import {generate} from '../';
import {readFile} from './tools';

const FIXTURES_FOLDER = path.join(__dirname, 'fixtures');

const ecmaVersion = 12;

const stripLocation = astravel.makeTraveler({
  go(node, state) {
    delete node.start;
    delete node.end;
    delete node.raw;
    if (node.directive) {
      delete node.directive;
    }
    this[node.type](node, state);
  },
  Property(node, state) {
    this.go(node.key, state);
    // Always walk through value, regardless of `node.shorthand` flag
    this.go(node.value, state);
  },
});

describe('astring', () => {
  it('Syntax check', () => {
    const dirname = path.join(FIXTURES_FOLDER, 'syntax');
    const files = fs.readdirSync(dirname).sort();
    const options = {
      ecmaVersion,
      sourceType: 'module',
    };
    files.forEach(filename => {
      const code = readFile(path.join(dirname, filename));
      const ast = parse(code, options);
      assert.equal(
        generate(ast),
        code,
        filename.substring(0, filename.length - 3),
        'Generates code with the expected format',
      );
    });
  });

  it('Babel AST check', () => {
    const dirname = path.join(FIXTURES_FOLDER, 'syntax');
    const files = fs.readdirSync(dirname).sort();
    const options = {
      allowReturnOutsideFunction: true,
      strictMode: false,
      sourceType: 'module',
    };
    files.forEach(filename => {
      const code = readFile(path.join(dirname, filename));
      const ast = babelParse(code, options);
      let {content} = generateAST({
        ast,
        sourceFileName: '/foo/bar.js',
        sourceMaps: false,
        originalSourceMap: null,
        options: {projectRoot: '/foo'},
      });
      assert.equal(
        content,
        code,
        filename.substring(0, filename.length - 3),
        'Generates code with the expected format',
      );
    });
  });

  it('Tree comparison', () => {
    const dirname = path.join(FIXTURES_FOLDER, 'tree');
    const files = fs.readdirSync(dirname).sort();
    const options = {
      ecmaVersion,
      sourceType: 'module',
    };
    files.forEach(filename => {
      const code = readFile(path.join(dirname, filename));
      const ast = parse(code, options);
      stripLocation.go(ast);
      const formattedAst = parse(generate(ast), options);
      stripLocation.go(formattedAst);
      assert.deepEqual(
        formattedAst,
        ast,
        filename.substring(0, filename.length - 3),
        'Generates code with the same meaning',
      );
    });
  });

  it('Deprecated syntax check', () => {
    const dirname = path.join(FIXTURES_FOLDER, 'deprecated');
    const files = fs.readdirSync(dirname).sort();
    files.forEach(filename => {
      const code = readFile(path.join(dirname, filename));
      const version = parseInt(filename.substring(2, filename.length - 3));
      const ast = parse(code, {ecmaVersion: version});
      assert.equal(generate(ast), code, 'es' + version);
    });
  });

  it('Output stream', () => {
    const code = 'const a = 42;\n';
    const output = {
      buffer: '',
      write(code) {
        this.buffer += code;
      },
    };
    const ast = parse(code, {
      ecmaVersion,
    });
    const result = generate(ast, {
      output,
    });
    assert.equal(result, output);
    assert.equal(result.buffer, code);
  });

  it('Comment generation', () => {
    const dirname = path.join(FIXTURES_FOLDER, 'comment');
    const files = fs.readdirSync(dirname).sort();
    const options = {
      comments: true,
    };
    files.forEach(filename => {
      const code = readFile(path.join(dirname, filename));
      const comments = [];
      const ast = parse(code, {
        ecmaVersion,
        locations: true,
        onComment: comments,
      });
      astravel.attachComments(ast, comments);
      assert.equal(
        generate(ast, options),
        code,
        filename.substring(0, filename.length - 3),
      );
    });
  });

  it('Source map generation', () => {
    const files = ['comment', 'syntax', 'sourcemap-cases']
      .map(fixture =>
        fs
          .readdirSync(path.join(FIXTURES_FOLDER, fixture))
          .map(file => path.join(FIXTURES_FOLDER, fixture, file)),
      )
      .reduce((acc, files) => [...acc, ...files], [])
      .map(file => ({file, contents: readFile(file)}));

    const mangle = code =>
      code
        .split(/\r?\n/g)
        .map(l => '  ' + l + (l.endsWith('\\') ? '' : '\n'))
        .join('\n');

    for (const {file, contents} of files) {
      const mangled = mangle(contents);
      const mangledLines = mangled.split('\n');

      const sourceMap = {
        mappings: [],
        _file: path.basename(file),
        addMapping({original, generated}) {
          this.mappings.push({
            original: {...original},
            generated: {...generated},
          });
        },
      };

      const ast = parse(mangled, {
        ecmaVersion,
        sourceType: 'module',
        locations: true,
      });

      const generatedLines = generate(ast, {
        sourceMap,
      }).split('\n');

      assert.ok(
        sourceMap.mappings.length > 0,
        `expected to have generated positions in ${file}`,
      );

      for (const {original, generated} of sourceMap.mappings) {
        assert.equal(
          mangledLines[original.line - 1].slice(original.column),
          generatedLines[generated.line - 1].slice(generated.column),
          `expected line ${generated.line} col ${generated.column} of ${file} to match`,
        );
      }
    }
  });
});
