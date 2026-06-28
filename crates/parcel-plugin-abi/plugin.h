#ifndef PARCEL_PLUGIN_H
#define PARCEL_PLUGIN_H

#include <stdint.h>

enum BundleBehavior
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_BUNDLE_BEHAVIOR_NONE = 0,
  PARCEL_BUNDLE_BEHAVIOR_INLINE = 1,
  PARCEL_BUNDLE_BEHAVIOR_ISOLATED = 2,
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum BundleBehavior BundleBehavior;
#else
typedef uint8_t BundleBehavior;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

enum AssetFlags
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint32_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_ASSET_IS_SOURCE = (1 << 0),
  PARCEL_ASSET_SIDE_EFFECTS = (1 << 1),
  PARCEL_ASSET_IS_BUNDLE_SPLITTABLE = (1 << 2),
  PARCEL_ASSET_LARGE_BLOB = (1 << 3),
  PARCEL_ASSET_HAS_CJS_EXPORTS = (1 << 4),
  PARCEL_ASSET_STATIC_EXPORTS = (1 << 5),
  PARCEL_ASSET_SHOULD_WRAP = (1 << 6),
  PARCEL_ASSET_IS_CONSTANT_MODULE = (1 << 7),
  PARCEL_ASSET_HAS_NODE_REPLACEMENTS = (1 << 8),
  PARCEL_ASSET_HAS_SYMBOLS = (1 << 9),
  PARCEL_ASSET_IS_HTML_ATTR = (1 << 10),
  PARCEL_ASSET_IS_HTML_TAG = (1 << 11),
  PARCEL_ASSET_IS_ESM = (1 << 12),
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum AssetFlags AssetFlags;
#else
typedef uint32_t AssetFlags;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

enum Environment
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_ENV_BROWSER = 0,
  PARCEL_ENV_WEB_WORKER = 1,
  PARCEL_ENV_SERVICE_WORKER = 2,
  PARCEL_ENV_WORKLET = 3,
  PARCEL_ENV_NODE = 4,
  PARCEL_ENV_ELECTRON_MAIN = 5,
  PARCEL_ENV_ELECTRON_RENDERER = 6,
  PARCEL_ENV_REACT_CLIENT = 7,
  PARCEL_ENV_REACT_SERVER = 8,
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum Environment Environment;
#else
typedef uint8_t Environment;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

enum OutputFormat
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_OUTPUT_FORMAT_GLOBAL = 0,
  PARCEL_OUTPUT_FORMAT_COMMONJS = 1,
  PARCEL_OUTPUT_FORMAT_ESMODULE = 2,
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum OutputFormat OutputFormat;
#else
typedef uint8_t OutputFormat;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

enum SourceType
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_SOURCE_TYPE_MODULE = 0,
  PARCEL_SOURCE_TYPE_SCRIPT = 1,
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum SourceType SourceType;
#else
typedef uint8_t SourceType;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

enum EnvironmentFlags
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_ENV_FLAG_IS_LIBRARY = (1 << 0),
  PARCEL_ENV_FLAG_SHOULD_OPTIMIZE = (1 << 1),
  PARCEL_ENV_FLAG_SHOULD_SCOPE_HOIST = (1 << 2),
  PARCEL_ENV_FLAG_MODULE_TYPE_EXTENSION = (1 << 3),
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum EnvironmentFlags EnvironmentFlags;
#else
typedef uint8_t EnvironmentFlags;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

enum SpecifierType
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_SPECIFIER_ESM = 0,
  PARCEL_SPECIFIER_COMMONJS = 1,
  PARCEL_SPECIFIER_URL = 2,
  PARCEL_SPECIFIER_CUSTOM = 3,
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum SpecifierType SpecifierType;
#else
typedef uint8_t SpecifierType;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

enum Priority
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_PRIORITY_SYNC = 0,
  PARCEL_PRIORITY_PARALLEL = 1,
  PARCEL_PRIORITY_LAZY = 2,
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum Priority Priority;
#else
typedef uint8_t Priority;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

enum DependencyFlags
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_DEP_ENTRY = (1 << 0),
  PARCEL_DEP_OPTIONAL = (1 << 1),
  PARCEL_DEP_NEEDS_STABLE_NAME = (1 << 2),
  PARCEL_DEP_IS_WEBWORKER = (1 << 3),
  PARCEL_DEP_SIDE_EFFECTS = (1 << 4),
  PARCEL_DEP_MACRO = (1 << 5),
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum DependencyFlags DependencyFlags;
#else
typedef uint8_t DependencyFlags;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

enum DiagnosticSeverity
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_SEVERITY_ERROR = 0,
  PARCEL_SEVERITY_WARNING = 1,
  PARCEL_SEVERITY_SOURCE_ERROR = 2,
  PARCEL_SEVERITY_INFO = 3,
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum DiagnosticSeverity DiagnosticSeverity;
#else
typedef uint8_t DiagnosticSeverity;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

enum ResolutionType
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_RESOLUTION_NONE = 0,
  PARCEL_RESOLUTION_FILE_PATH = 1,
  PARCEL_RESOLUTION_EXTERNAL = 2,
  PARCEL_RESOLUTION_EXCLUDED = 3,
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum ResolutionType ResolutionType;
#else
typedef uint8_t ResolutionType;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

/**
 * Owned byte buffer returned by getter functions.
 * Release with `parcel_free_buffer()` when done.
 * Zero-initialise before use so a no-op getter leaves `data == NULL`.
 */
typedef struct Buffer {
  uint8_t *data;
  uintptr_t len;
  uintptr_t cap;
} Buffer;

/**
 * Opaque handle to a Parcel asset. Pass to `parcel_asset_*` functions.
 */
typedef uint64_t Asset;

/**
 * Opaque handle to Parcel build options. Passed to all plugin entry points.
 */
typedef uint64_t Options;

/**
 * Opaque handle to a Parcel target. Obtained via `parcel_asset_get_target()`.
 */
typedef uint64_t Target;

/**
 * Dependency descriptor passed to `parcel_asset_add_dependency()`.
 * Use `PARCEL_SPECIFIER_ESM` / `PARCEL_PRIORITY_SYNC` / `PARCEL_BUNDLE_BEHAVIOR_NONE` as defaults.
 */
typedef struct DependencyOptions {
  /**
   * Module specifier bytes (e.g. `"./foo.js"`). Required.
   */
  const uint8_t *specifier;
  /**
   * Byte length of `specifier`.
   */
  uintptr_t specifier_len;
  /**
   * `PARCEL_SPECIFIER_*`
   */
  SpecifierType specifier_type;
  /**
   * `PARCEL_PRIORITY_*`
   */
  Priority priority;
  /**
   * `PARCEL_BUNDLE_BEHAVIOR_*`
   */
  BundleBehavior bundle_behavior;
  /**
   * `PARCEL_DEP_*` bits
   */
  DependencyFlags flags;
} DependencyOptions;

/**
 * Opaque handle to a Parcel dependency. Passed to `parcel_plugin_resolve()`.
 */
typedef uint64_t Dependency;

/**
 * Diagnostic written by a plugin to report an error or warning.
 * The host zero-initialises this before every plugin call.
 * Fill via `parcel_buffer_alloc()`; host frees all `Buffer` fields after the call.
 * If `message.data == NULL` after the call, no diagnostic was set.
 */
typedef struct Diagnostic {
  struct Buffer message;
  struct Buffer file_path;
  uint32_t line;
  uint32_t column;
  struct Buffer hint;
  /**
   * `PARCEL_SEVERITY_*`
   */
  DiagnosticSeverity severity;
} Diagnostic;

/**
 * Result filled by a resolver plugin's `parcel_plugin_resolve()`.
 * The struct is zero-initialised by the host before the call.
 *
 * When type == PARCEL_RESOLUTION_FILE_PATH, fill `file_path` (and optionally `pipeline`) via `parcel_buffer_alloc()`.
 */
typedef struct ResolveResult {
  /**
   * `PARCEL_RESOLUTION_*`
   */
  ResolutionType resolution_type;
  struct Buffer file_path;
  struct Buffer pipeline;
} ResolveResult;

#ifdef __cplusplus
extern "C" {
#endif // __cplusplus

/**
 * Release a `Buffer` previously filled by a getter or `parcel_buffer_alloc()`.
 */
void parcel_free_buffer(struct Buffer *buf);

/**
 * Allocates a new `Buffer` containing a copy of `[data, data+len)`.
 * The plugin calls this to fill `ResolveResult` or `Diagnostic` fields.
 * Returns a zero `Buffer` when `data` is NULL or `len` is 0.
 */
struct Buffer parcel_buffer_alloc(const uint8_t *data, uintptr_t len);

/**
 * Returns the asset content into `*buf`. Caller must `parcel_free_buffer(buf)`.
 */
void parcel_asset_get_content(struct Buffer *buf, Asset asset);

/**
 * Replaces the asset content with the given bytes.
 */
void parcel_asset_set_content(Asset asset, const uint8_t *data, uint32_t len);

/**
 * Returns the asset type extension (e.g. `"js"`, `"css"`) into `*buf`.
 * Caller must `parcel_free_buffer(buf)`.
 */
void parcel_asset_get_type(struct Buffer *buf, Asset asset);

/**
 * Changes the asset type to the given file-extension bytes (e.g. `"js"`).
 */
void parcel_asset_set_type(Asset asset, const uint8_t *ty, uintptr_t ty_len);

/**
 * Returns the absolute filesystem path of the source asset into `*buf`.
 * `options` is the handle received from `parcel_plugin_transform()`.
 * Caller must `parcel_free_buffer(buf)`.
 */
void parcel_asset_get_file_path(struct Buffer *buf, Asset asset, Options _options);

/**
 * Returns the named pipeline into `*buf`, or leaves `buf->data == NULL` if none is set.
 * Caller must `parcel_free_buffer(buf)` when `data != NULL`.
 */
void parcel_asset_get_pipeline(struct Buffer *buf, Asset asset);

/**
 * Sets the named pipeline. Pass `NULL` / `0` to clear.
 */
void parcel_asset_set_pipeline(Asset asset, const uint8_t *pipeline, uintptr_t pipeline_len);

/**
 * Returns the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
 */
BundleBehavior parcel_asset_get_bundle_behavior(Asset asset);

/**
 * Sets the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
 */
void parcel_asset_set_bundle_behavior(Asset asset, BundleBehavior behavior);

/**
 * Returns the raw `AssetFlags` bitfield (`PARCEL_ASSET_*` bits).
 */
AssetFlags parcel_asset_get_flags(Asset asset);

/**
 * Replaces the `AssetFlags` bitfield.
 */
void parcel_asset_set_flags(Asset asset, AssetFlags flags);

/**
 * Returns the unique key into `*buf`, or leaves `buf->data == NULL` if not set.
 * Caller must `parcel_free_buffer(buf)` when `data != NULL`.
 */
void parcel_asset_get_unique_key(struct Buffer *buf, Asset asset);

/**
 * Sets the unique key. Pass `NULL` / `0` to clear.
 */
void parcel_asset_set_unique_key(Asset asset, const uint8_t *key, uintptr_t key_len);

/**
 * Returns an opaque `Target` handle. Valid for the duration of the transform call.
 */
Target parcel_asset_get_target(Asset asset);

/**
 * Returns the target environment (`PARCEL_ENV_*`).
 */
Environment parcel_target_get_environment(Target target);

/**
 * Returns the output format (`PARCEL_OUTPUT_FORMAT_*`).
 */
OutputFormat parcel_target_get_output_format(Target target);

/**
 * Returns the source type (`PARCEL_SOURCE_TYPE_*`).
 */
SourceType parcel_target_get_source_type(Target target);

/**
 * Returns the `EnvironmentFlags` bitfield (`PARCEL_ENV_FLAG_*` bits).
 */
EnvironmentFlags parcel_target_get_env_flags(Target target);

/**
 * Returns the public URL (e.g. `"/"`) into `*buf`. Caller must `parcel_free_buffer(buf)`.
 */
void parcel_target_get_public_url(struct Buffer *buf, Target target);

/**
 * Returns the absolute path of the dist directory into `*buf`.
 * `options` is the handle received from `parcel_plugin_transform()`.
 * Caller must `parcel_free_buffer(buf)`.
 */
void parcel_target_get_dist_dir(struct Buffer *buf, Target target, Options _options);

/**
 * Appends a dependency to the asset. The new dependency inherits the asset's target.
 */
void parcel_asset_add_dependency(Asset asset, const struct DependencyOptions *dep);

/**
 * Registers an exported symbol name (e.g. `"default"`, `"foo"`, `"*"`).
 */
void parcel_asset_add_export_symbol(Asset asset, const uint8_t *name, uintptr_t name_len);

/**
 * Returns the raw specifier string (e.g. `"custom:greeting"`) into `*buf`.
 */
void parcel_dep_get_specifier(struct Buffer *buf, Dependency dep);

/**
 * Returns the specifier type (`PARCEL_SPECIFIER_*`).
 */
SpecifierType parcel_dep_get_specifier_type(Dependency dep);

/**
 * Returns the priority (`PARCEL_PRIORITY_*`).
 */
Priority parcel_dep_get_priority(Dependency dep);

/**
 * Returns the bundle behavior (`PARCEL_BUNDLE_BEHAVIOR_*`).
 */
BundleBehavior parcel_dep_get_bundle_behavior(Dependency dep);

/**
 * Returns the raw `DependencyFlags` bitfield (`PARCEL_DEP_*` bits).
 */
DependencyFlags parcel_dep_get_flags(Dependency dep);

/**
 * Returns the absolute path of the file containing this import into `*buf`.
 */
void parcel_dep_get_source_path(struct Buffer *buf, Dependency dep, Options _options);

/**
 * Returns the base path for resolving the specifier into `*buf`.
 * Falls back to the source file path when `resolve_from` is not set.
 */
void parcel_dep_get_resolve_from(struct Buffer *buf, Dependency dep, Options _options);

/**
 * Returns an opaque `Target` handle for the dependency.
 */
Target parcel_dep_get_target(Dependency dep);

/**
 * Returns the project root as an absolute filesystem path into `*buf`.
 * Caller must `parcel_free_buffer(buf)`.
 */
void parcel_options_get_project_root(struct Buffer *buf, Options options);

/**
 * Looks up `key` in the build environment map.
 * Writes the value into `*buf` if found; leaves `buf->data == NULL` if not.
 * Caller must `parcel_free_buffer(buf)` when `data != NULL`.
 */
void parcel_options_get_env(struct Buffer *buf,
                            Options options,
                            const uint8_t *key,
                            uintptr_t key_len);

#ifdef __cplusplus
}  // extern "C"
#endif  // __cplusplus

#endif  /* PARCEL_PLUGIN_H */
