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

export type Config = JSONObject;
export type SourceMap = JSONObject;

export type Transformer = {
  getConfig(asset: TransformerAsset): ConfigOutput,
  canReuseAST(ast: AST): boolean,
  parse(asset: TransformerAsset, config: Config): AST,
  transform(asset: TransformerAsset, config: Config): [TransformerAsset],
  generate(asset: TransformerAsset, config: Config): TransformerOutput,
  postProcess(
    assets: Array<TransformerAsset>,
    config: Config
  ): Array<TransformerAsset>
};

export type TransformerAsset = {
  filePath: string,
  code: string,
  ast: AST | null,
  dependencies: Array<Dependency>,
  output: TransformerOutput
};

export type TransformerOutput = {
  code: string,
  map: SourceMap,
  [string]: string
};

export type CacheEntry = {
  filePath: string,
  hash: string,
  assets: Array<Asset>
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
