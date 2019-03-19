// @flow

export type Config = any;

export type AST = {|
  type: string,
  version: string,
  program: any,
  isDirty?: boolean
|};

export interface Node {
  id: string;
  +type?: string;
  value: any;
}
