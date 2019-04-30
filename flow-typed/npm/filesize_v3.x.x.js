// flow-typed signature: d872520535951848ae5eb6fbfce3ef99
// flow-typed version: 4b3001dbfa/filesize_v3.x.x/flow_>=v0.25.0

declare module 'filesize' {
  declare type Options = {
    base?: number,
    bits?: boolean,
    exponent?: number,
    fullform?: boolean,
    fullforms?: Array<mixed>,
    output?: 'array' | 'exponent' | 'object' | 'string',
    round?: number,
    spacer?: string,
    standard?: string,
    symbols?: Object,
    unix?: boolean
  };

  declare module.exports: {
    (arg: number | string, options?: Options): string
  };
}
