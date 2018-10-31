// flow-typed signature: dc381ee55406f66b7272c6343db0834b
// flow-typed version: da30fe6876/semver_v5.1.x/flow_>=v0.25.x

declare module 'semver' {
  declare type Release =
    | 'major'
    | 'premajor'
    | 'minor'
    | 'preminor'
    | 'patch'
    | 'prepatch'
    | 'prerelease';

  // The supported comparators are taken from the source here:
  // https://github.com/npm/node-semver/blob/8bd070b550db2646362c9883c8d008d32f66a234/semver.js#L623
  declare type Operator =
    | '==='
    | '!=='
    | '=='
    | '='
    | '' // Not sure why you would want this, but whatever.
    | '!='
    | '>'
    | '>='
    | '<'
    | '<=';

  declare class SemVer {
    build: Array<string>;
    loose: ?boolean;
    major: number;
    minor: number;
    patch: number;
    prerelease: Array<string | number>;
    raw: string;
    version: string;

    constructor(version: string | SemVer, loose?: boolean): SemVer;
    compare(other: string | SemVer): -1 | 0 | 1;
    compareMain(other: string | SemVer): -1 | 0 | 1;
    comparePre(other: string | SemVer): -1 | 0 | 1;
    format(): string;
    inc(release: Release, identifier: string): this;
  }

  declare class Comparator {
    loose?: boolean;
    operator: Operator;
    semver: SemVer;
    value: string;

    constructor(comp: string | Comparator, loose?: boolean): Comparator;
    parse(comp: string): void;
    test(version: string): boolean;
  }

  declare class Range {
    loose: ?boolean;
    raw: string;
    set: Array<Array<Comparator>>;

    constructor(range: string | Range, loose?: boolean): Range;
    format(): string;
    parseRange(range: string): Array<Comparator>;
    test(version: string): boolean;
    toString(): string;
  }

  declare var SEMVER_SPEC_VERSION: string;
  declare var re: Array<RegExp>;
  declare var src: Array<string>;

  // Functions
  declare function valid(v: string | SemVer, loose?: boolean): string | null;
  declare function clean(v: string | SemVer, loose?: boolean): string | null;
  declare function inc(
    v: string | SemVer,
    release: Release,
    loose?: boolean,
    identifier?: string
  ): string | null;
  declare function inc(
    v: string | SemVer,
    release: Release,
    identifier: string
  ): string | null;
  declare function major(v: string | SemVer, loose?: boolean): number;
  declare function minor(v: string | SemVer, loose?: boolean): number;
  declare function patch(v: string | SemVer, loose?: boolean): number;

  // Comparison
  declare function gt(
    v1: string | SemVer,
    v2: string | SemVer,
    loose?: boolean
  ): boolean;
  declare function gte(
    v1: string | SemVer,
    v2: string | SemVer,
    loose?: boolean
  ): boolean;
  declare function lt(
    v1: string | SemVer,
    v2: string | SemVer,
    loose?: boolean
  ): boolean;
  declare function lte(
    v1: string | SemVer,
    v2: string | SemVer,
    loose?: boolean
  ): boolean;
  declare function eq(
    v1: string | SemVer,
    v2: string | SemVer,
    loose?: boolean
  ): boolean;
  declare function neq(
    v1: string | SemVer,
    v2: string | SemVer,
    loose?: boolean
  ): boolean;
  declare function cmp(
    v1: string | SemVer,
    comparator: Operator,
    v2: string | SemVer,
    loose?: boolean
  ): boolean;
  declare function compare(
    v1: string | SemVer,
    v2: string | SemVer,
    loose?: boolean
  ): -1 | 0 | 1;
  declare function rcompare(
    v1: string | SemVer,
    v2: string | SemVer,
    loose?: boolean
  ): -1 | 0 | 1;
  declare function compareLoose(
    v1: string | SemVer,
    v2: string | SemVer
  ): -1 | 0 | 1;
  declare function diff(v1: string | SemVer, v2: string | SemVer): ?Release;
  declare function sort(
    list: Array<string | SemVer>,
    loose?: boolean
  ): Array<string | SemVer>;
  declare function rsort(
    list: Array<string | SemVer>,
    loose?: boolean
  ): Array<string | SemVer>;
  declare function compareIdentifiers(
    v1: string | SemVer,
    v2: string | SemVer
  ): -1 | 0 | 1;
  declare function rcompareIdentifiers(
    v1: string | SemVer,
    v2: string | SemVer
  ): -1 | 0 | 1;

  // Ranges
  declare function validRange(
    range: string | Range,
    loose?: boolean
  ): string | null;
  declare function satisfies(
    version: string | SemVer,
    range: string | Range,
    loose?: boolean
  ): boolean;
  declare function maxSatisfying(
    versions: Array<string | SemVer>,
    range: string | Range,
    loose?: boolean
  ): string | SemVer | null;
  declare function gtr(
    version: string | SemVer,
    range: string | Range,
    loose?: boolean
  ): boolean;
  declare function ltr(
    version: string | SemVer,
    range: string | Range,
    loose?: boolean
  ): boolean;
  declare function outside(
    version: string | SemVer,
    range: string | Range,
    hilo: '>' | '<',
    loose?: boolean
  ): boolean;

  // Not explicitly documented, or deprecated
  declare function parse(version: string, loose?: boolean): ?SemVer;
  declare function toComparators(
    range: string | Range,
    loose?: boolean
  ): Array<Array<string>>;
}
