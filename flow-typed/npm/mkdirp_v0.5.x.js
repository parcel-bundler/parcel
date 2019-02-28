// flow-typed signature: 82aa0feffc2bbd64dce3bec492f5d601
// flow-typed version: 3315d89a00/mkdirp_v0.5.x/flow_>=v0.25.0

declare module 'mkdirp' {
  declare type Options = number | {mode?: number, fs?: mixed};

  declare type Callback = (err: ?Error, path: ?string) => void;

  declare module.exports: {
    (path: string, options?: Options | Callback, callback?: Callback): void,
    sync(path: string, options?: Options): void
  };
}
