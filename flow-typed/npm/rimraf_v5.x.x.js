// https://github.com/flow-typed/flow-typed/pull/4556

declare module 'rimraf' {
  declare type Options = {
    maxRetries?: number,
    glob?: boolean,
    ...
  };

  declare module.exports: {
    (f: string, opts?: Options): Promise<boolean>,
    sync(path: string, opts?: Options): boolean,
    ...
  };
}
