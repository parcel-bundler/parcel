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

async function applyFixture(
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
      await fs.symlink(node.target, path.join(dir, node.name));
      break;
    }
    default: {
      /*:: ((node: empty) => void 0)(node); */
      throw new Error(`Unexpected node type "${node.type}"`);
    }
  }
}

const NAME = /([^:>\n\\\/]+)(?=\/|\b)/.source;
const EOL = / *(?:\n|$)/.source;
const CONTENT = /"(.*)"/.source; // TODO: support multiline
const PATH = /([^:>\n]+)\b/.source;

const TOKEN_TYPES = {
  nest: /^(\/|  )/,
  dirname: new RegExp(`^${NAME}(?:(?=\/)|${EOL})`),
  filename: new RegExp(`^${NAME}(?= *(?::|->))`),
  content: new RegExp(`^ *: *${CONTENT}${EOL}`),
  link: new RegExp(`^ *-> *${PATH}${EOL}`),
};

export class FixtureTokenizer {
  #src: string;
  #tokens: Array<FixtureToken>;

  #tokenizeNext = () => {
    for (let type in TOKEN_TYPES) {
      let match = this.#src.match(TOKEN_TYPES[type]);
      if (match) {
        let [substr, value] = match;
        this.#src = this.#src.slice(substr.length);
        this.#tokens.push({type, value});
        return;
      }
    }
    throw new Error(`Failed to match token on "${this.#src}"`);
  };

  constructor(src: string) {
    this.#src = src;
  }

  tokenize(): Array<FixtureToken> {
    if (!this.#tokens) {
      this.#tokens = [];
      while (this.#src.length > 0) {
        this.#tokenizeNext();
      }
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
        assert(!isSegment, 'Unexpected segment nest');
        isSegment = true;
      } else {
        assert(!isSegment, 'Unexpected indent nest');
        depth++;
      }
    }

    if (!isSegment) {
      assert(depth <= this.#dirStack.length, 'Invalid nesting');
      this.#dirStack = this.#dirStack.slice(0, depth + 1);
      this.#cwd = this.#dirStack[this.#dirStack.length - 1];
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
}

export class FixtureDir {
  type: 'dir' = 'dir';
  name: string;
  children: Array<FixtureChild> = [];
  constructor(name: string) {
    this.name = name;
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
}

export class FixtureLink {
  type: 'link' = 'link';
  name: string;
  target: string;
  constructor(name: string, target: string) {
    this.name = name;
    this.target = target;
  }
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

  let dedent = nullthrows(src.match(/^(?:  )*/))[0].length;

  if (dedent === 0) {
    dedent = Infinity;
    for (let indent of nullthrows(src.match(/^(?:  )*/gm))) {
      let len = indent.length - 2;
      if (len >= 0 && len < dedent) dedent = len;
    }
  }

  if (dedent < Infinity && dedent > 0) {
    src = src.replace(new RegExp(`^ {${dedent}}`, 'gm'), '');
  }

  return src;
}
