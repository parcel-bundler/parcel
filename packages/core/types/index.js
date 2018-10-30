// @flow

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | Array<JSONValue>
  | JSONObject;

export type JSONObject = {
  [key: string]: JSONValue
};

export type Dependency = {
  sourcePath: string,
  moduleSpecifier: string,
  isAsync?: boolean,
  isEntry?: boolean,
  isOptional?: boolean,
  isIncluded?: boolean
};

export type File = {
  filePath: string
};

export type Asset = {
  id: string,
  filePath: string,
  dependencies: Array<Dependency>,
  hash: string
};

export type AST = {
  kind: string,
  version: string,
  program: JSONObject
};

export type CLIOptions = JSONObject;
export type Config = JSONObject;
export type SourceMap = JSONObject;

export type TransformerInput = {
  filePath: string,
  code: string,
  ast: ?AST
};

export type TransformerResult = {
  type: string,
  code?: string,
  ast?: AST,
  dependencies?: Array<Dependency>,
  output?: TransformerOutput
};

export type TransformerOutput = {
  code: string,
  map?: SourceMap,
  [string]: string
};

export interface Transformer {
  getConfig?: (filePath: string, opts: CLIOptions) => ConfigOutput;
  canReuseAST?: (ast: AST, opts: CLIOptions) => boolean;
  parse(asset: TransformerInput, config: ?Config, opts: CLIOptions): AST;
  transform(
    asset: TransformerInput,
    config: ?Config,
    opts: CLIOptions
  ): Array<TransformerResult>;
  generate(
    asset: TransformerInput,
    config: ?Config,
    opts: CLIOptions
  ): TransformerOutput;
  postProcess?: (
    assets: Array<TransformerResult>,
    config: ?Config,
    opts: CLIOptions
  ) => Array<TransformerResult>;
}

export type CacheAsset = {
  hash: string,
  dependencies: Array<Dependency>,
  output: TransformerOutput
};

export type CacheEntry = {
  filePath: string,
  hash: string,
  assets: Array<CacheAsset>
};

export type ConfigOutput = {
  config: Config,
  dependencies: Array<Dependency>
};

export type ParcelConfig = {
  transforms: {
    [string]: Array<string>
  }
};
