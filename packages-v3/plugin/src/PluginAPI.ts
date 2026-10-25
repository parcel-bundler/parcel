import type {
  DiagnosticOptions,
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
