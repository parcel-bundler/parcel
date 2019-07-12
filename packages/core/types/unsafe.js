// @flow

export type ThirdPartyConfig = any;

export type AST = {|
  type: string,
  version: string,
  program: any,
  isDirty?: boolean
|};
