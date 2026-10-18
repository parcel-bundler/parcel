import type {
  Transformer as TransformerOpts,
  Resolver as ResolverOpts,
  Namer as NamerOpts,
  Optimizer as OptimizerOpts,
  Reporter as ReporterOpts,
} from './types';

export * from './types';

const CONFIG = Symbol.for('parcel-plugin-config');

export class Transformer<T> {
  constructor(opts: TransformerOpts<T>) {
    // @ts-ignore
    this[CONFIG] = opts;
  }
}

export class Resolver<T> {
  constructor(opts: ResolverOpts<T>) {
    // @ts-ignore
    this[CONFIG] = opts;
  }
}

export class Namer<T> {
  constructor(opts: NamerOpts<T>) {
    // @ts-ignore
    this[CONFIG] = opts;
  }
}

export class Optimizer<T> {
  constructor(opts: OptimizerOpts<T>) {
    // @ts-ignore
    this[CONFIG] = opts;
  }
}

export class Reporter<T> {
  constructor(opts: ReporterOpts<T>) {
    // @ts-ignore
    this[CONFIG] = opts;
  }
}
