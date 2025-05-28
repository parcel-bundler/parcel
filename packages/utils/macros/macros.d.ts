export interface MacroContext {
  /** Adds an asset as a dependency of the JS module that called this macro. */
  addAsset(asset: MacroAsset): void;
  /** The source location of the macro call. */
  loc: SourceLocation;
  /** Invalidate the macro call whenever the given file changes. */
  invalidateOnFileChange(filePath: string): void;
  /** Invalidate the macro call when a file matching the given pattern is created. */
  invalidateOnFileCreate(options: FileCreateInvalidation): void;
  /** Invalidate the macro whenever the given environment variable changes. */
  invalidateOnEnvChange(env: string): void;
  /** Invalidate the macro whenever Parcel restarts. */
  invalidateOnStartup(): void;
  /** Invalidate the macro on every build. */
  invalidateOnBuild(): void;
}

/**
 * Source locations are 1-based, meaning lines and columns start at 1
 */
export type SourceLocation = {
  readonly filePath: string;

  /** inclusive */
  readonly start: {
    readonly line: number;
    readonly column: number;
  };

  /** exclusive */
  readonly end: {
    readonly line: number;
    readonly column: number;
  };
};

export interface MacroAsset {
  /** The type of the asset (e.g. `'css'`). */
  type: string;
  /** The content of the asset. */
  content: string;
}

export type FileCreateInvalidation =
  | FileInvalidation
  | GlobInvalidation
  | FileAboveInvalidation;

/** Invalidate when a file matching a glob is created. */
export interface GlobInvalidation {
  glob: string;
}

/** Invalidate when a specific file is created. */
export interface FileInvalidation {
  filePath: string;
}

/** Invalidate when a file of a specific name is created above a certain directory in the hierarchy. */
export interface FileAboveInvalidation {
  fileName: string;
  aboveFilePath: string;
}
