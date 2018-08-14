// @flow
import { type Writable } from 'stream';

export type MODULE_RENDITION_IDENTIFIER_THING = string;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | Array<JsonValue>
  | JsonObject;

export type JsonObject = {
  [key: string]: JsonValue
};

export type SourceMap = JsonValue;

export type FilePath = string;
export type Glob = string;

export type FileType = 'js' | 'css' | 'html' | 'etc...';
export type ModuleSpecifier = string; // ~/tilde, ./relative, /absolute, module, glob/**

export type SourceLocation = {
  filePath: string,
  start: { line: number, column: number },
  end: { line: number, column: number },
};

export type ModuleEnvironment = {
  // ..????
  // standalone?
};

export type Dependency = {
  parentId: ModuleId,
  // sourcePath: FilePath, // cwd, or parent filePath
  moduleSpecifier: ModuleSpecifier,
  loc: SourceLocation | null,
  env: ModuleEnvironment,
  isAsync: boolean,
  isEntry: boolean,
  isOptional: boolean,
  isIncluded: boolean,
  meta: JsonObject,
};

export type ModuleId = MODULE_RENDITION_IDENTIFIER_THING;

export type Module = {
  id: ModuleId,
  filePath: FilePath,
  env: ModuleEnvironment,
  type: FileType,
  code: string,
  map: SourceMap | null,
  meta: JsonObject,
};

type Ast = {
  kind: string,
  version: string,
  program: JsonObject
};

type ModuleGraph = {
  nodes: Array<ModuleId>;
  edges: Array<{
    parentId: ModuleId,
    childId: ModuleId,
    dependency: Dependency,
  }>;
};

type Bundle = {
  filePath: FilePath,
  moduleIds: Array<ModuleId>,
};

type FileSystem = {
  readFile: (filePath: string) => Promise<string>,
  writeFile: (filePath: string, fileContents: string | Buffer) => Promise<void>,
};

type GlobalEnv = {
  mode: 'production' | 'development',
  hmr: boolean,
  hmrHostname: string,
  hmrPort: string,
  publicUrl: string,
};

declare function resolve(opts: { dependency: Dependency, fs: FileSystem, globalEnv: GlobalEnv }): {
  filePath: FilePath | Glob,
};

type Resolver = {
  resolve(opts: {
    dependency: Dependency,
    fs: FileSystem,
    globalEnv: GlobalEnv,
  }): Promise<{

  }>
};

type Transformer = {
  config(opts: {
    module: Module,
    fs: FileSystem,
    env: GlobalEnv,
  }): Promise<{
    config: JsonValue
  }>,

  // parse(opts: {
  //   module: Module,
  //   env: GlobalEnv,
  // }): Promise<{
  //   ast: Ast
  // }>,

  transform(opts: {
    module: Module,
    // ast: Ast,
    env: GlobalEnv,
  }): Promise<{
    results: Array<{
      module: Module,
      dependencies: Array<Dependency>
    }>
  }>,

  // generate(opts: {
  //   module: Module,
  //   ast: Ast,
  //   env: GlobalEnv,
  // }): Promise<{
  //   // ...
  // }>,
};



declare function transform(opts: { module: Module, globalEnv: GlobalEnv }): {
  results: Array<{
    module: Module,
    dependencies: Array<Dependency>,
  }>,
};

// -> { moduleId, dependencies, env }

declare function strategy(opts: { moduleGraph: ModuleGraph }): {
  bundles: Array<Bundle>,
};

declare function package(opts: { bundle: Bundle }): {
  files: Array<{ }>,
};
