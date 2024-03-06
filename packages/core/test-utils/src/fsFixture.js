// @flow strict-local

import type {FileSystem} from '@parcel/fs';

import assert from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';

type FixtureToken = {|type: string, value: string|};

type Fixture = FixtureRoot | FixtureChild;
type FixtureChild = FixtureDir | FixtureFile | FixtureLink;

export function fsFixture(
  fs: FileSystem,
  cwd: string = fs.cwd(),
): (
  strings: Array<string>,
  ...exprs: Array<
    null | string | number | boolean | interface {} | $ReadOnlyArray<mixed>,
  >
) => Promise<void> {
  return async function apply(strings, ...exprs) {
    let src = dedentRaw(strings, ...exprs);
    let tokens = new FixtureTokenizer(src).tokenize();
    let fixture = new FixtureParser(tokens).parse();
    await applyFixture(fs, fixture, cwd);
  };
}

declare function toFixture(
  fs: FileSystem,
  dir?: string,
): Promise<FixtureRoot | FixtureDir>;

// eslint-disable-next-line no-redeclare
declare function toFixture(
  fs: FileSystem,
  dir: string,
  includeDir?: boolean,
): Promise<FixtureRoot | FixtureDir>;

// eslint-disable-next-line no-redeclare
declare function toFixture<T>(
  fs: FileSystem,
  dir: string,
  parent: T,
): Promise<T>;

const DISALLOWED_FILETYPES = new Set([
  '.crt',
  '.gitkeep',
  '.gif',
  '.jpeg',
  '.jpg',
  '.pem',
  '.png',
  '.webp',
]);

const MAX_FILE_SIZE = 1000;

// eslint-disable-next-line no-redeclare
export async function toFixture(
  fs: FileSystem,
  dir: string = fs.cwd(),
  fixtureOrIncludeDir?: FixtureRoot | FixtureDir | boolean = false,
) {
  let fixture: FixtureRoot | FixtureDir;
  if (fixtureOrIncludeDir == null || typeof fixtureOrIncludeDir === 'boolean') {
    fixture = new FixtureRoot();
    if (fixtureOrIncludeDir) {
      fixture.children.push(
        await toFixture(fs, dir, new FixtureDir(path.basename(dir))),
      );
      return fixture;
    }
  } else {
    fixture = nullthrows(fixtureOrIncludeDir);
  }

  assert(
    (await fs.stat(dir)).isDirectory(),
    `Expected ${dir} to be a directory`,
  );

  for (let dirent of await fs.readdir(dir, {withFileTypes: true})) {
    let name = dirent.name;
    let filepath = path.join(dir, name);
    if (dirent.isSymbolicLink()) {
      // FIXME: `realpath` is not the correct behavior here,
      // but Parcel fs doesn't define `readlink.
      let target = await fs.realpath(filepath);
      fixture.children.push(new FixtureLink(name, toPosixPath(target)));
    } else if (dirent.isFile()) {
      if (DISALLOWED_FILETYPES.has(path.extname(dirent.name))) {
        throw new Error(`Disallowed file type: ${name}`);
      }

      let size = (await fs.stat(filepath)).size;
      if (size > MAX_FILE_SIZE) {
        throw new Error(`File too large: ${name}`);
      }

      let content = escapeFixtureContent(await fs.readFile(filepath, 'utf8'));
      fixture.children.push(new FixtureFile(name, content));
    } else if (dirent.isDirectory()) {
      fixture.children.push(
        await toFixture(fs, filepath, new FixtureDir(name)),
      );
    } else {
      throw new Error(`Unknown file type: ${name}`);
    }
  }
  return fixture;
}

export async function applyFixture(
  fs: FileSystem,
  node: Fixture,
  dir: string,
): Promise<void> {
  switch (node.type) {
    case 'root': {
      for (let child of node.children) {
        await applyFixture(fs, child, dir);
      }
      break;
    }
    case 'dir': {
      let filepath = path.join(dir, node.name);
      await fs.mkdirp(filepath);
      for (let child of node.children) {
        await applyFixture(fs, child, filepath);
      }
      break;
    }
    case 'file': {
      await fs.writeFile(path.join(dir, node.name), node.content);
      break;
    }
    case 'link': {
      // $FlowFixMe[prop-missing]
      await fs.symlink(node.target, path.join(dir, node.name));
      break;
    }
    default: {
      /*:: ((node: empty) => void 0)(node); */
      throw new Error(`Unexpected node type "${node.type}"`);
    }
  }
}

// Named capture groups that can be directly tokenized.
// e.g., a string matching `nest` can be tokenized as `nest` token,
// a match for `dirname` can be tokenized as a `dirname` token, etc.
const TOKEN_TYPES = [
  // `/` in `a/b` or `  ` in `a\n  b`
  /^(?<nest>[/\\]| {2})/,
  // e.g. `a` or `b` in `a/b/c.txt`
  /^(?<dirname>[^:>\n/\\]+\b)(?:(?=[/\\])| *\n| *$)/,
  // e.g. `c.txt` in `a/b/c.txt:` or `a/b/c.txt ->`
  /^(?<filename>[^:>\n/\\]+\b) *(?:->|:) *(?:\n|$)/,
];

// Named capture groups that can be directly tokenized,
// with the exception of the `indent` and `path` groups, which
// capture patterns that should be subsequently matched on `TOKEN_TYPES`.
const COMPOUND_TYPES = [
  // Matches empty lines that are meant to be ignored.
  /^(?<empty> *)\n/,
  // Matches are captured as `indent` and`path` groups,
  // which can then be matched to `TOKEN_TYPES`.
  /^(?<indent>(?: {2})*)(?<path>[^:>\n]+\b) *(?:\n|$)/,
  // Matches are captured as `indent`,`path`, and `link` groups.
  // The `indent` and `path` groups can be matched to `TOKEN_TYPES`,
  // and then `link` can be directly tokenized as `link`.
  /^(?<indent>(?: {2})*)(?<path>[^:>\n]+\b *->) *(?<link>.+\b) *(?:\n|$)/,
  // Matches are captured as `indent`,`path`, and `content` groups.
  // The `indent` and `path` groups can be matched to `TOKEN_TYPES`,
  // and then `content` can be directly tokenized as `content`.
  /^(?<indent>(?: {2})*)(?<path>[^:>\n]+\b *:)(?<content>.*(?:\n^(?:$|\k<indent> {2}.*))*) *(?:\n|$)/m,
];

const MAX_ITER = 10000;

function checkIteration(i, str) {
  if (i >= MAX_ITER) {
    throw new Error(`Possible infinite loop while tokenizing "${str}"`);
  }
  return i + 1;
}

function toPosixPath(str) {
  return str.replace(/^[A-Z]:\\/, '/').replace(/\\/g, '/');
}

export class FixtureTokenizer {
  #src: string;
  #tokens: Array<FixtureToken>;

  #tokenizeNext = (src, types) => {
    for (let expr of types) {
      let match = src.match(expr);
      if (match) {
        let {indent, path, ...groups} = nullthrows(match.groups);
        if (indent != null) this.#tokenize(indent, TOKEN_TYPES);
        if (path != null) this.#tokenize(path, TOKEN_TYPES);

        // Additional tokens that aren't captured by `indent` and `path`.
        for (let type in groups) {
          // Ignore empty lines.
          if (type === 'empty') continue;
          // If the value is multiline, dedent each line.
          let value = groups[type]
            .trim()
            .replace(new RegExp(`^${indent} {2}(.*)$`, 'gm'), '$1');
          if (type === 'nest' || type === 'link') {
            value = toPosixPath(value);
          }
          this.#tokens.push({type, value});
        }

        return src.slice(match[0].length);
      }
    }

    throw new Error(`Failed to match token on "${src}"`);
  };

  #tokenize = (src, types = COMPOUND_TYPES) => {
    let i = 0;
    while (src.length > 0) {
      // It is _possible_ (though not expected!) to loop infinitely here,
      // so guard against that by throwing if we count a lot of iterations.
      i = checkIteration(i, src);
      // $FlowFixMe[reassign-const]
      src = this.#tokenizeNext(src, types);
    }
  };

  constructor(src: string) {
    this.#src = src;
  }

  tokenize(): Array<FixtureToken> {
    if (!this.#tokens) {
      this.#tokens = [];
      this.#tokenize(this.#src);
    }
    return this.#tokens;
  }
}

export class FixtureParser {
  #tokens: Array<FixtureToken>;
  #root: FixtureRoot;
  #cwd: FixtureRoot | FixtureDir;
  #dirStack: Array<FixtureRoot | FixtureDir>;

  #peek = type => this.#tokens[this.#tokens.length - 1]?.type === type;

  #consume = type => {
    let token = this.#tokens.pop();
    if (token?.type !== type) {
      throw new Error(
        `Expected token of type "${type}" but got "${token?.type}"`,
      );
    }
    return token;
  };

  #parseNest = () => {
    let depth = 0;
    let isSegment = false;
    let nest;
    while (this.#peek('nest')) {
      nest = this.#consume('nest');
      if (nest.value === '/') {
        assert(!isSegment && !depth, 'Unexpected segment nest');
        isSegment = true;
      } else {
        assert(!isSegment, 'Unexpected indent nest');
        depth++;
      }
    }

    if (!isSegment) {
      assert(depth < this.#dirStack.length, 'Invalid nesting');
      this.#dirStack = this.#dirStack.slice(0, depth + 1);
      this.#cwd = this.#dirStack[this.#dirStack.length - 1];
    } else {
      assert(this.#dirStack.length > 1, 'Invalid nesting');
      this.#dirStack.pop();
    }
  };

  #parseDir = () => {
    let dir = new FixtureDir(this.#consume('dirname').value);
    this.#cwd.children.push(dir);
    this.#cwd = dir;
    this.#dirStack.push(dir);
  };

  #parseFile = () => {
    let name = this.#consume('filename').value;
    if (this.#peek('content')) {
      let content = this.#consume('content').value;
      this.#cwd.children.push(new FixtureFile(name, content));
    } else if (this.#peek('link')) {
      let target = this.#consume('link').value;
      this.#cwd.children.push(new FixtureLink(name, target));
    } else {
      throw new Error(
        `Expected content or link token but got ${this.#tokens.pop()?.type}`,
      );
    }
  };

  constructor(tokens: Array<FixtureToken>) {
    this.#tokens = [...tokens].reverse();
  }

  parse(): FixtureRoot {
    if (!this.#root) {
      this.#root = new FixtureRoot();
      this.#cwd = this.#root;
      this.#dirStack = [this.#root];

      // Consume any leading `nest` tokens.
      // This allows a fixture path to start with '/'.
      while (this.#peek('nest')) {
        this.#consume('nest');
      }

      while (this.#tokens.length) {
        this.#parseNest();
        if (this.#peek('dirname')) {
          this.#parseDir();
        } else if (this.#peek('filename')) {
          this.#parseFile();
        } else {
          throw new Error(`Unexpected ${this.#tokens.pop()?.type} token`);
        }
      }
    }
    return this.#root;
  }
}

export class FixtureRoot {
  type: 'root' = 'root';
  children: Array<FixtureChild> = [];
  toString(): string {
    return this.children.map(child => child.toString()).join('\n');
  }
}

export class FixtureDir {
  type: 'dir' = 'dir';
  name: string;
  children: Array<FixtureChild> = [];
  constructor(name: string) {
    this.name = name;
  }
  toString(): string {
    return [this.name]
      .concat(
        this.children.flatMap(child =>
          child
            .toString()
            .split('\n')
            .map(line => `  ${line}`),
        ),
      )
      .join('\n');
  }
}

export class FixtureFile {
  type: 'file' = 'file';
  name: string;
  content: string;
  constructor(name: string, content: string) {
    this.name = name;
    this.content = content;
  }
  toString(): string {
    return [`${this.name}:`]
      .concat(this.content.split('\n').map(line => `  ${line}`))
      .join('\n');
  }
}

export class FixtureLink {
  type: 'link' = 'link';
  name: string;
  target: string;
  constructor(name: string, target: string) {
    this.name = name;
    this.target = target;
  }
  toString(): string {
    return `${this.name} -> ${this.target}`;
  }
}

export function escapeFixtureContent(content: string): string {
  return content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\${/g, '\\${');
}

export function dedentRaw(
  strings: Array<string>,
  ...exprs: Array<
    null | string | number | boolean | interface {} | $ReadOnlyArray<mixed>,
  >
): string {
  let src = '';
  for (let i = 0; i < strings.length; i++) {
    src += strings[i];
    if (i < exprs.length) {
      let expr = exprs[i];
      if (typeof expr !== 'string') {
        expr = JSON.stringify(exprs[i]).replace(/^"|"$/g, '');
      }
      src += expr;
    }
  }
  src = src.trimRight().replace(/^ *\n?/, '');

  let dedent = nullthrows(src.match(/^(?: {2})*/))[0].length;

  if (dedent === 0) {
    dedent = Infinity;
    for (let indent of nullthrows(src.match(/^(?: {2})*/gm))) {
      let len = indent.length - 2;
      if (len >= 0 && len < dedent) dedent = len;
    }
  }

  if (dedent < Infinity && dedent > 0) {
    src = src.replace(new RegExp(`^ {${dedent}}`, 'gm'), '');
  }

  return src;
}
