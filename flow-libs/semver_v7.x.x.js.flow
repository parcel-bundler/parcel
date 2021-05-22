// Generated from @types/semver using github.com/aminya/flowgen-package
declare module "semver" {
  import type * as semverParse from "semver/functions/parse"
  import type * as semverValid from "semver/functions/valid"
  import type * as semverClean from "semver/functions/clean"
  import type * as semverInc from "semver/functions/inc"
  import type * as semverDiff from "semver/functions/diff"
  import type * as semverMajor from "semver/functions/major"
  import type * as semverMinor from "semver/functions/minor"
  import type * as semverPatch from "semver/functions/patch"
  import type * as semverPrerelease from "semver/functions/prerelease"
  import type * as semverCompare from "semver/functions/compare"
  import type * as semverRcompare from "semver/functions/rcompare"
  import type * as semverCompareLoose from "semver/functions/compare-loose"
  import type * as semverCompareBuild from "semver/functions/compare-build"
  import type * as semverSort from "semver/functions/sort"
  import type * as semverRsort from "semver/functions/rsort"
  declare export {
    semverParse as parse,
    semverValid as valid,
    semverClean as clean,
    semverInc as inc,
    semverDiff as diff,
    semverMajor as major,
    semverMinor as minor,
    semverPatch as patch,
    semverPrerelease as prerelease,
    semverCompare as compare,
    semverRcompare as rcompare,
    semverCompareLoose as compareLoose,
    semverCompareBuild as compareBuild,
    semverSort as sort,
    semverRsort as rsort,
  };
  import type * as semverGt from "semver/functions/gt"
  import type * as semverLt from "semver/functions/lt"
  import type * as semverEq from "semver/functions/eq"
  import type * as semverNeq from "semver/functions/neq"
  import type * as semverGte from "semver/functions/gte"
  import type * as semverLte from "semver/functions/lte"
  import type * as semverCmp from "semver/functions/cmp"
  import type * as semverCoerce from "semver/functions/coerce"
  declare export {
    semverGt as gt,
    semverLt as lt,
    semverEq as eq,
    semverNeq as neq,
    semverGte as gte,
    semverLte as lte,
    semverCmp as cmp,
    semverCoerce as coerce,
  };
  import type * as semverSatisfies from "semver/functions/satisfies"
  import type * as semverMaxSatisfying from "semver/ranges/max-satisfying"
  import type * as semverMinSatisfying from "semver/ranges/min-satisfying"
  import type * as semverToComparators from "semver/ranges/to-comparators"
  import type * as semverMinVersion from "semver/ranges/min-version"
  import type * as semverValidRange from "semver/ranges/valid"
  import type * as semverOutside from "semver/ranges/outside"
  import type * as semverGtr from "semver/ranges/gtr"
  import type * as semverLtr from "semver/ranges/ltr"
  import type * as semverIntersects from "semver/ranges/intersects"
  import type * as simplify from "semver/ranges/simplify"
  import type * as rangeSubset from "semver/ranges/subset"
  declare export {
    semverSatisfies as satisfies,
    semverMaxSatisfying as maxSatisfying,
    semverMinSatisfying as minSatisfying,
    semverToComparators as toComparators,
    semverMinVersion as minVersion,
    semverValidRange as validRange,
    semverOutside as outside,
    semverGtr as gtr,
    semverLtr as ltr,
    semverIntersects as intersects,
    simplify as simplifyRange,
    rangeSubset as subset,
  };
  import type * as SemVer from "semver/classes/semver"
  import type * as Range from "semver/classes/range"
  import type * as Comparator from "semver/classes/comparator"
  declare export { SemVer, Range, Comparator };
  import type * as identifiers from "semver/internals/identifiers"
  declare export var compareIdentifiers: typeof identifiers.compareIdentifiers;
  declare export var rcompareIdentifiers: typeof identifiers.rcompareIdentifiers;
  declare export var SEMVER_SPEC_VERSION: "2.0.0";
  declare export type ReleaseType =
    | "major"
    | "premajor"
    | "minor"
    | "preminor"
    | "patch"
    | "prepatch"
    | "prerelease";
  declare export interface Options {
    loose?: boolean;
    includePrerelease?: boolean;
  }
  declare export type CoerceOptions = {
    /**
     * Used by `coerce()` to coerce from right to left.
     * @default false
     * @example coerce('1.2.3.4', { rtl: true });
     * // => SemVer { version: '2.3.4', ... }
     * @since 6.2.0
     */
    rtl?: boolean,
    ...
  } & Options;
  declare export type Operator =
    | "==="
    | "!=="
    | ""
    | "="
    | "=="
    | "!="
    | ">"
    | ">="
    | "<"
    | "<=";

}

// Generated from @types/semver/preload using github.com/aminya/flowgen-package
declare module "semver/preload" {
  import type * as semver from "semver/"
  declare module.exports: typeof semver;

}

// Generated from @types/semver/classes/comparator using github.com/aminya/flowgen-package
declare module "semver/classes/comparator" {
  import type * as semver from "semver"
  import type * as SemVer from "semver/classes/semver"
  declare class Comparator {
    constructor(
      comp: string | Comparator,
      optionsOrLoose?: boolean | semver.Options
    ): this;
    semver: SemVer;
    operator: "" | "=" | "<" | ">" | "<=" | ">=";
    value: string;
    loose: boolean;
    options: semver.Options;
    parse(comp: string): void;
    test(version: string | SemVer): boolean;
    intersects(
      comp: Comparator,
      optionsOrLoose?: boolean | semver.Options
    ): boolean;
  }
  declare module.exports: typeof Comparator;

}

// Generated from @types/semver/classes/range using github.com/aminya/flowgen-package
declare module "semver/classes/range" {
  import type * as semver from "semver"
  import type * as Comparator from "semver/classes/comparator"
  import type * as SemVer from "semver/classes/semver"
  declare class Range {
    constructor(
      range: string | Range,
      optionsOrLoose?: boolean | semver.Options
    ): this;
    range: string;
    raw: string;
    loose: boolean;
    options: semver.Options;
    includePrerelease: boolean;
    format(): string;
    inspect(): string;
    set: $ReadOnlyArray<$ReadOnlyArray<Comparator>>;
    parseRange(range: string): $ReadOnlyArray<Comparator>;
    test(version: string | SemVer): boolean;
    intersects(range: Range, optionsOrLoose?: boolean | semver.Options): boolean;
  }
  declare module.exports: typeof Range;

}

// Generated from @types/semver/classes/semver using github.com/aminya/flowgen-package
declare module "semver/classes/semver" {
  import type * as semver from "semver"
  declare class SemVer {
    constructor(
      version: string | SemVer,
      optionsOrLoose?: boolean | semver.Options
    ): this;
    raw: string;
    loose: boolean;
    options: semver.Options;
    format(): string;
    inspect(): string;
    major: number;
    minor: number;
    patch: number;
    version: string;
    build: $ReadOnlyArray<string>;
    prerelease: $ReadOnlyArray<string | number>;

    /**
     * Compares two versions excluding build identifiers (the bit after `+` in the semantic version string).
     * @return - `0` if `this` == `other`
     * - `1` if `this` is greater
     * - `-1` if `other` is greater.
     */
    compare(other: string | SemVer): 1 | 0 | -1;

    /**
     * Compares the release portion of two versions.
     * @return - `0` if `this` == `other`
     * - `1` if `this` is greater
     * - `-1` if `other` is greater.
     */
    compareMain(other: string | SemVer): 1 | 0 | -1;

    /**
     * Compares the prerelease portion of two versions.
     * @return - `0` if `this` == `other`
     * - `1` if `this` is greater
     * - `-1` if `other` is greater.
     */
    comparePre(other: string | SemVer): 1 | 0 | -1;

    /**
     * Compares the build identifier of two versions.
     * @return - `0` if `this` == `other`
     * - `1` if `this` is greater
     * - `-1` if `other` is greater.
     */
    compareBuild(other: string | SemVer): 1 | 0 | -1;
    inc(release: semver.ReleaseType, identifier?: string): SemVer;
  }
  declare module.exports: typeof SemVer;

}

// Generated from @types/semver/functions/clean using github.com/aminya/flowgen-package
declare module "semver/functions/clean" {
  import type * as semver from "semver"
  /**
   * Returns cleaned (removed leading/trailing whitespace, remove '=v' prefix) and parsed version, or null if version is invalid.
   */
  declare function clean(
    version: string,
    optionsOrLoose?: boolean | semver.Options
  ): string | null;
  declare module.exports: typeof clean;

}

// Generated from @types/semver/functions/cmp using github.com/aminya/flowgen-package
declare module "semver/functions/cmp" {
  import type * as semver from "semver"
  import type * as SemVer from "semver/classes/semver"
  /**
   * Pass in a comparison string, and it'll call the corresponding semver comparison function.
   * "===" and "!==" do simple string comparison, but are included for completeness.
   * Throws if an invalid comparison string is provided.
   */
  declare function cmp(
    v1: string | SemVer,
    operator: semver.Operator,
    v2: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof cmp;

}

// Generated from @types/semver/functions/coerce using github.com/aminya/flowgen-package
declare module "semver/functions/coerce" {
  import type * as semver from "semver"
  import type * as SemVer from "semver/classes/semver"
  /**
   * Coerces a string to SemVer if possible
   */
  declare function coerce(
    version: string | number | SemVer | null | void,
    options?: semver.CoerceOptions
  ): SemVer | null;
  declare module.exports: typeof coerce;

}

// Generated from @types/semver/functions/compare-build using github.com/aminya/flowgen-package
declare module "semver/functions/compare-build" {
  import type * as SemVer from "semver/classes/semver"
  /**
   * Compares two versions including build identifiers (the bit after `+` in the semantic version string).
   *
   * Sorts in ascending order when passed to `Array.sort()`.
   * @return - `0` if `v1` == `v2`
   * - `1` if `v1` is greater
   * - `-1` if `v2` is greater.
   * @since 6.1.0
   */
  declare function compareBuild(
    a: string | SemVer,
    b: string | SemVer
  ): 1 | 0 | -1;
  declare module.exports: typeof compareBuild;

}

// Generated from @types/semver/functions/compare-loose using github.com/aminya/flowgen-package
declare module "semver/functions/compare-loose" {
  import type * as SemVer from "semver/classes/semver"
  declare function compareLoose(
    v1: string | SemVer,
    v2: string | SemVer
  ): 1 | 0 | -1;
  declare module.exports: typeof compareLoose;

}

// Generated from @types/semver/functions/compare using github.com/aminya/flowgen-package
declare module "semver/functions/compare" {
  import type * as semver from "semver"
  import type * as SemVer from "semver/classes/semver"
  /**
   * Compares two versions excluding build identifiers (the bit after `+` in the semantic version string).
   *
   * Sorts in ascending order when passed to `Array.sort()`.
   * @return - `0` if `v1` == `v2`
   * - `1` if `v1` is greater
   * - `-1` if `v2` is greater.
   */
  declare function compare(
    v1: string | SemVer,
    v2: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): 1 | 0 | -1;
  declare module.exports: typeof compare;

}

// Generated from @types/semver/functions/diff using github.com/aminya/flowgen-package
declare module "semver/functions/diff" {
  import type * as semver from "semver"
  import type * as SemVer from "semver/classes/semver"
  /**
   * Returns difference between two versions by the release type (major, premajor, minor, preminor, patch, prepatch, or prerelease), or null if the versions are the same.
   */
  declare function diff(
    v1: string | SemVer,
    v2: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): semver.ReleaseType | null;
  declare module.exports: typeof diff;

}

// Generated from @types/semver/functions/eq using github.com/aminya/flowgen-package
declare module "semver/functions/eq" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * v1 == v2 This is true if they're logically equivalent, even if they're not the exact same string. You already know how to compare strings.
   */
  declare function eq(
    v1: string | SemVer,
    v2: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof eq;

}

// Generated from @types/semver/functions/gt using github.com/aminya/flowgen-package
declare module "semver/functions/gt" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * v1 > v2
   */
  declare function gt(
    v1: string | SemVer,
    v2: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof gt;

}

// Generated from @types/semver/functions/gte using github.com/aminya/flowgen-package
declare module "semver/functions/gte" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * v1 >= v2
   */
  declare function gte(
    v1: string | SemVer,
    v2: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof gte;

}

// Generated from @types/semver/functions/inc using github.com/aminya/flowgen-package
declare module "semver/functions/inc" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return the version incremented by the release type (major, minor, patch, or prerelease), or null if it's not valid.
   */
  declare function inc(
    version: string | SemVer,
    release: semver.ReleaseType,
    optionsOrLoose?: boolean | semver.Options,
    identifier?: string
  ): string | null;
  declare function inc(
    version: string | SemVer,
    release: semver.ReleaseType,
    identifier?: string
  ): string | null;
  declare module.exports: typeof inc;

}

// Generated from @types/semver/functions/lt using github.com/aminya/flowgen-package
declare module "semver/functions/lt" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * v1 < v2
   */
  declare function lt(
    v1: string | SemVer,
    v2: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof lt;

}

// Generated from @types/semver/functions/lte using github.com/aminya/flowgen-package
declare module "semver/functions/lte" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * v1 <= v2
   */
  declare function lte(
    v1: string | SemVer,
    v2: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof lte;

}

// Generated from @types/semver/functions/major using github.com/aminya/flowgen-package
declare module "semver/functions/major" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return the major version number.
   */
  declare function major(
    version: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): number;
  declare module.exports: typeof major;

}

// Generated from @types/semver/functions/minor using github.com/aminya/flowgen-package
declare module "semver/functions/minor" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return the minor version number.
   */
  declare function minor(
    version: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): number;
  declare module.exports: typeof minor;

}

// Generated from @types/semver/functions/neq using github.com/aminya/flowgen-package
declare module "semver/functions/neq" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * v1 != v2 The opposite of eq.
   */
  declare function neq(
    v1: string | SemVer,
    v2: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof neq;

}

// Generated from @types/semver/functions/parse using github.com/aminya/flowgen-package
declare module "semver/functions/parse" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return the parsed version as a SemVer object, or null if it's not valid.
   */
  declare function parse(
    version: string | SemVer | null | void,
    optionsOrLoose?: boolean | semver.Options
  ): SemVer | null;
  declare module.exports: typeof parse;

}

// Generated from @types/semver/functions/patch using github.com/aminya/flowgen-package
declare module "semver/functions/patch" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return the patch version number.
   */
  declare function patch(
    version: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): number;
  declare module.exports: typeof patch;

}

// Generated from @types/semver/functions/prerelease using github.com/aminya/flowgen-package
declare module "semver/functions/prerelease" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Returns an array of prerelease components, or null if none exist.
   */
  declare function prerelease(
    version: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): $ReadOnlyArray<string | number> | null;
  declare module.exports: typeof prerelease;

}

// Generated from @types/semver/functions/rcompare using github.com/aminya/flowgen-package
declare module "semver/functions/rcompare" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * The reverse of compare.
   *
   * Sorts in descending order when passed to `Array.sort()`.
   */
  declare function rcompare(
    v1: string | SemVer,
    v2: string | SemVer,
    optionsOrLoose?: boolean | semver.Options
  ): 1 | 0 | -1;
  declare module.exports: typeof rcompare;

}

// Generated from @types/semver/functions/rsort using github.com/aminya/flowgen-package
declare module "semver/functions/rsort" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Sorts an array of semver entries in descending order using `compareBuild()`.
   */
  declare function rsort<T: string | SemVer>(
    list: T[],
    optionsOrLoose?: boolean | semver.Options
  ): T[];
  declare module.exports: typeof rsort;

}

// Generated from @types/semver/functions/satisfies using github.com/aminya/flowgen-package
declare module "semver/functions/satisfies" {
  import type * as Range from "semver/classes/range"
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return true if the version satisfies the range.
   */
  declare function satisfies(
    version: string | SemVer,
    range: string | Range,
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof satisfies;

}

// Generated from @types/semver/functions/sort using github.com/aminya/flowgen-package
declare module "semver/functions/sort" {
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Sorts an array of semver entries in ascending order using `compareBuild()`.
   */
  declare function sort<T: string | SemVer>(
    list: T[],
    optionsOrLoose?: boolean | semver.Options
  ): T[];
  declare module.exports: typeof sort;

}

// Generated from @types/semver/functions/valid using github.com/aminya/flowgen-package
declare module "semver/functions/valid" {
  import type * as semver from "semver"
  import type * as SemVer from "semver/classes/semver"
  /**
   * Return the parsed version as a string, or null if it's not valid.
   */
  declare function valid(
    version: string | SemVer | null | void,
    optionsOrLoose?: boolean | semver.Options
  ): string | null;
  declare module.exports: typeof valid;

}

// Generated from @types/semver/internals/identifiers using github.com/aminya/flowgen-package
declare module "semver/internals/identifiers" {
  /**
   * Compares two identifiers, must be numeric strings or truthy/falsy values.
   *
   * Sorts in ascending order when passed to `Array.sort()`.
   */
  declare export function compareIdentifiers(
    a: string | null | void,
    b: string | null | void
  ): 1 | 0 | -1;

  /**
   * The reverse of compareIdentifiers.
   *
   * Sorts in descending order when passed to `Array.sort()`.
   */
  declare export function rcompareIdentifiers(
    a: string | null | void,
    b: string | null | void
  ): 1 | 0 | -1;

}

// Generated from @types/semver/ranges/gtr using github.com/aminya/flowgen-package
declare module "semver/ranges/gtr" {
  import type * as Range from "semver/classes/range"
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return true if version is greater than all the versions possible in the range.
   */
  declare function gtr(
    version: string | SemVer,
    range: string | Range,
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof gtr;

}

// Generated from @types/semver/ranges/intersects using github.com/aminya/flowgen-package
declare module "semver/ranges/intersects" {
  import type * as Range from "semver/classes/range"
  import type * as semver from "semver"
  /**
   * Return true if any of the ranges comparators intersect
   */
  declare function intersects(
    range1: string | Range,
    range2: string | Range,
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof intersects;

}

// Generated from @types/semver/ranges/ltr using github.com/aminya/flowgen-package
declare module "semver/ranges/ltr" {
  import type * as Range from "semver/classes/range"
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return true if version is less than all the versions possible in the range.
   */
  declare function ltr(
    version: string | SemVer,
    range: string | Range,
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof ltr;

}

// Generated from @types/semver/ranges/max-satisfying using github.com/aminya/flowgen-package
declare module "semver/ranges/max-satisfying" {
  import type * as Range from "semver/classes/range"
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return the highest version in the list that satisfies the range, or null if none of them do.
   */
  declare function maxSatisfying<T: string | SemVer>(
    versions: $ReadOnlyArray<T>,
    range: string | Range,
    optionsOrLoose?: boolean | semver.Options
  ): T | null;
  declare module.exports: typeof maxSatisfying;

}

// Generated from @types/semver/ranges/min-satisfying using github.com/aminya/flowgen-package
declare module "semver/ranges/min-satisfying" {
  import type * as Range from "semver/classes/range"
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return the lowest version in the list that satisfies the range, or null if none of them do.
   */
  declare function minSatisfying<T: string | SemVer>(
    versions: $ReadOnlyArray<T>,
    range: string | Range,
    optionsOrLoose?: boolean | semver.Options
  ): T | null;
  declare module.exports: typeof minSatisfying;

}

// Generated from @types/semver/ranges/min-version using github.com/aminya/flowgen-package
declare module "semver/ranges/min-version" {
  import type * as Range from "semver/classes/range"
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return the lowest version that can possibly match the given range.
   */
  declare function minVersion(
    range: string | Range,
    optionsOrLoose?: boolean | semver.Options
  ): SemVer | null;
  declare module.exports: typeof minVersion;

}

// Generated from @types/semver/ranges/outside using github.com/aminya/flowgen-package
declare module "semver/ranges/outside" {
  import type * as Range from "semver/classes/range"
  import type * as SemVer from "semver/classes/semver"
  import type * as semver from "semver"
  /**
   * Return true if the version is outside the bounds of the range in either the high or low direction.
   * The hilo argument must be either the string '>' or '<'. (This is the function called by gtr and ltr.)
   */
  declare function outside(
    version: string | SemVer,
    range: string | Range,
    hilo: ">" | "<",
    optionsOrLoose?: boolean | semver.Options
  ): boolean;
  declare module.exports: typeof outside;

}

// Generated from @types/semver/ranges/simplify using github.com/aminya/flowgen-package
declare module "semver/ranges/simplify" {
  import type * as Range from "semver/classes/range"
  import type * as semver from "semver"
  /**
   * Return a "simplified" range that matches the same items in `versions` list as the range specified.
   * Note that it does *not* guarantee that it would match the same versions in all cases,
   * only for the set of versions provided.
   * This is useful when generating ranges by joining together multiple versions with `||` programmatically,
   * to provide the user with something a bit more ergonomic.
   * If the provided range is shorter in string-length than the generated range, then that is returned.
   */
  declare function simplify(
    ranges: string[],
    range: string | Range,
    options?: semver.Options
  ): string | Range;
  declare module.exports: typeof simplify;

}

// Generated from @types/semver/ranges/subset using github.com/aminya/flowgen-package
declare module "semver/ranges/subset" {
  import type * as Range from "semver/classes/range"
  import type * as semver from "semver"
  /**
   * Return true if the subRange range is entirely contained by the superRange range.
   */
  declare function subset(
    sub: string | Range,
    dom: string | Range,
    options?: semver.Options
  ): boolean;
  declare module.exports: typeof subset;

}

// Generated from @types/semver/ranges/to-comparators using github.com/aminya/flowgen-package
declare module "semver/ranges/to-comparators" {
  import type * as Range from "semver/classes/range"
  import type * as semver from "semver"
  /**
   * Mostly just for testing and legacy API reasons
   */
  declare function toComparators(
    range: string | Range,
    optionsOrLoose?: boolean | semver.Options
  ): string;
  declare module.exports: typeof toComparators;

}

// Generated from @types/semver/ranges/valid using github.com/aminya/flowgen-package
declare module "semver/ranges/valid" {
  import type * as Range from "semver/classes/range"
  import type * as semver from "semver"
  /**
   * Return the valid range or null if it's not valid
   */
  declare function validRange(
    range: string | Range | null | void,
    optionsOrLoose?: boolean | semver.Options
  ): string;
  declare module.exports: typeof validRange;

}