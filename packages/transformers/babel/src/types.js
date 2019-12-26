// @flow

export type BabelConfig = {|
  plugins?: Array<any>,
  presets?: Array<any>,
|};

export type BabelTargets = {
  browsers?: string | Array<string>,
  esmodules?: boolean,
  [string]: string,
  ...
};
