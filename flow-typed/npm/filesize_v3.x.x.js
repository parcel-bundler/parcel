// flow-typed signature: 8bdcf1e6de5f9208e131b8e7b29125f1
// flow-typed version: c6154227d1/filesize_v3.x.x/flow_>=v0.104.x

declare module "filesize" {
  declare type Options = {
    base?: number,
    bits?: boolean,
    exponent?: number,
    fullform?: boolean,
    fullforms?: Array<mixed>,
    output?: "array" | "exponent" | "object" | "string",
    round?: number,
    spacer?: string,
    standard?: string,
    symbols?: Object,
    unix?: boolean,
    ...
  };

  declare module.exports: { (arg: number | string, options?: Options): string, ... };
}
