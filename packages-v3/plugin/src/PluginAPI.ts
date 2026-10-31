import type {
  DiagnosticOptions,
  Transformer as TransformerOpts,
  Resolver as ResolverOpts,
  Namer as NamerOpts,
  Optimizer as OptimizerOpts,
  Reporter as ReporterOpts,
} from './types';

export * from './types';

// Parcel finds a plugin's methods under a key for the kind of plugin it is configured as, which
// every copy of this package agrees on. A plugin of another kind, or one written for Parcel 2,
// fails with a diagnostic rather than misbehaving.
export class Transformer<T> {
  constructor(opts: TransformerOpts<T>) {
    // @ts-ignore
    this[Symbol.for('parcel.plugin.v3.transformer')] = opts;
  }
}

export class Resolver<T> {
  constructor(opts: ResolverOpts<T>) {
    // @ts-ignore
    this[Symbol.for('parcel.plugin.v3.resolver')] = opts;
  }
}

export class Namer<T> {
  constructor(opts: NamerOpts<T>) {
    // @ts-ignore
    this[Symbol.for('parcel.plugin.v3.namer')] = opts;
  }
}

export class Optimizer<T> {
  constructor(opts: OptimizerOpts<T>) {
    // @ts-ignore
    this[Symbol.for('parcel.plugin.v3.optimizer')] = opts;
  }
}

export class Reporter<T> {
  constructor(opts: ReporterOpts<T>) {
    // @ts-ignore
    this[Symbol.for('parcel.plugin.v3.reporter')] = opts;
  }
}

/**
 * An error carrying one or more diagnostics. Throw it from a plugin to fail with them, or pass
 * it to a `console` method to log them at that level.
 */
export class Diagnostic extends Error {
  readonly diagnostics: Array<DiagnosticOptions>;

  constructor(diagnostic: DiagnosticOptions | Array<DiagnosticOptions>) {
    let diagnostics = Array.isArray(diagnostic) ? diagnostic : [diagnostic];
    super(diagnostics[0]?.message ?? '');
    this.name = 'Diagnostic';
    this.diagnostics = diagnostics;
  }
}

// Parcel reads the diagnostics from this symbol, which every copy of this package agrees on.
Object.defineProperty(Diagnostic.prototype, Symbol.for('parcel-diagnostics'), {
  get(this: Diagnostic) {
    return this.diagnostics;
  },
});
