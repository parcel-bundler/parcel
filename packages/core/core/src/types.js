// @flow
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
  hash: string,
  filePath: string,
  dependencies: Array<Dependency>
};
