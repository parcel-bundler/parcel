// @flow

export type Config = any;

export type AST = {|
  type: string,
  version: string,
  program: any,
  isDirty?: boolean
|};
