// flow-typed signature: 4c5b8e467850f482876c1b4ee92e2cba
// flow-typed version: c6154227d1/tempy_v0.x.x/flow_>=v0.104.x

type $npm$tempy$Options = {
  extension?: string,
  name?: string,
  ...
};

declare module "tempy" {
  declare module.exports: {
    directory: () => string,
    file: (options?: $npm$tempy$Options) => string,
    root: string,
    ...
  };
}
