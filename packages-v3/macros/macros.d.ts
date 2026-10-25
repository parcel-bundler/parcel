export interface MacroContext {
  /** Adds an asset as a dependency of the JS module that called this macro. */
  addAsset(asset: MacroAsset): void;
  /** The source location of the macro call. */
  readonly loc: SourceLocation;
}

/** The location where a macro was called. */
export type SourceLocation = {
  readonly filePath: string;
  /** The line of the start of the call expression (1-based). */
  readonly line: number;
  /** The column of the start of the call expression (0-based). */
  readonly col: number;
};

export interface MacroAsset {
  /** The type of the asset (e.g. `'css'`). */
  type: string;
  /** The content of the asset. */
  content: string;
}
