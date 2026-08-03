#ifndef PARCEL_PLUGIN_H
#define PARCEL_PLUGIN_H

#include <stdint.h>
#include <stdbool.h>

/**
 * The plugin ABI implemented by this build of Parcel.
 *
 * Bumped whenever a change would make an existing plugin binary unsafe to load:
 * a changed or removed [`ParcelApi`] field, or a changed plugin entry point
 * signature. Appending to `ParcelApi` is compatible in both directions and does
 * not bump it — the `size` field covers that case.
 *
 * Bumping this invalidates every plugin ever built, so prefer appending. To give
 * a host function a different signature, append a new field and leave the old one
 * pointing at a shim: `abi` stays put and existing plugins keep working across
 * the upgrade. That leaves plugin entry point signatures, which are not in this
 * table, as about the only thing a bump is genuinely needed for.
 *
 * A published plugin repeats this in its package.json as `parcel.abi`, which
 * lets Parcel reject a mismatch before opening the library. That copy is
 * human-written metadata; the authoritative check is the one the plugin makes
 * against this field.
 */
#define PARCEL_ABI_VERSION 1

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

enum BundleGraphResolutionType
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_BUNDLE_GRAPH_RESOLUTION_INVALID = 0,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_NONE = 1,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_DEFERRED = 2,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_EXTERNAL = 3,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_EXCLUDED = 4,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET = 5,
  PARCEL_BUNDLE_GRAPH_RESOLUTION_BUNDLE = 6,
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum BundleGraphResolutionType BundleGraphResolutionType;
#else
typedef uint8_t BundleGraphResolutionType;
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

/**
 * Result of a plugin's `parcel_plugin_init()`.
 *
 * A plugin that cannot use the [`ParcelApi`](crate::ParcelApi) table it was
 * handed returns `PARCEL_INIT_INCOMPATIBLE` without writing a diagnostic — it
 * has no way to allocate one, since allocating goes through the very table it
 * just rejected. Parcel writes that diagnostic instead.
 */
enum InitStatus
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  /**
   * The plugin initialized. Its state, if any, is in the `state` out param.
   */
  PARCEL_INIT_OK = 0,
  /**
   * The plugin failed and wrote a diagnostic describing why.
   */
  PARCEL_INIT_ERROR = 1,
  /**
   * The plugin cannot run against this build of Parcel. No diagnostic was
   * written; Parcel reports the mismatch.
   */
  PARCEL_INIT_INCOMPATIBLE = 2,
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum InitStatus InitStatus;
#else
typedef uint8_t InitStatus;
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

/**
 * Conditions used when resolving package `exports` and `imports` fields.
 */
enum ExportsConditions
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint32_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_EXPORTS_CONDITION_IMPORT = (1 << 0),
  PARCEL_EXPORTS_CONDITION_REQUIRE = (1 << 1),
  PARCEL_EXPORTS_CONDITION_MODULE = (1 << 2),
  PARCEL_EXPORTS_CONDITION_NODE = (1 << 3),
  PARCEL_EXPORTS_CONDITION_BROWSER = (1 << 4),
  PARCEL_EXPORTS_CONDITION_WORKER = (1 << 5),
  PARCEL_EXPORTS_CONDITION_WORKLET = (1 << 6),
  PARCEL_EXPORTS_CONDITION_ELECTRON = (1 << 7),
  PARCEL_EXPORTS_CONDITION_DEVELOPMENT = (1 << 8),
  PARCEL_EXPORTS_CONDITION_PRODUCTION = (1 << 9),
  PARCEL_EXPORTS_CONDITION_TYPES = (1 << 10),
  PARCEL_EXPORTS_CONDITION_DEFAULT = (1 << 11),
  PARCEL_EXPORTS_CONDITION_STYLE = (1 << 12),
  PARCEL_EXPORTS_CONDITION_SASS = (1 << 13),
  PARCEL_EXPORTS_CONDITION_LESS = (1 << 14),
  PARCEL_EXPORTS_CONDITION_STYLUS = (1 << 15),
  PARCEL_EXPORTS_CONDITION_REACT_SERVER = (1 << 16),
  PARCEL_EXPORTS_CONDITION_SOURCE = (1 << 17),
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum ExportsConditions ExportsConditions;
#else
typedef uint32_t ExportsConditions;
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

enum BundleFlags
#if defined(__cplusplus) || __STDC_VERSION__ >= 202311L
  : uint8_t
#endif // defined(__cplusplus) || __STDC_VERSION__ >= 202311L
 {
  PARCEL_BUNDLE_FLAG_NEEDS_STABLE_NAME = (1 << 0),
  PARCEL_BUNDLE_FLAG_IS_SPLITTABLE = (1 << 1),
  PARCEL_BUNDLE_FLAG_IS_PLACEHOLDER = (1 << 2),
  PARCEL_BUNDLE_FLAG_ENTRY = (1 << 3),
};
#ifndef __cplusplus
#if __STDC_VERSION__ >= 202311L
typedef enum BundleFlags BundleFlags;
#else
typedef uint8_t BundleFlags;
#endif // __STDC_VERSION__ >= 202311L
#endif // __cplusplus

/**
 * Index of an asset within the bundle graph.
 */
typedef uint32_t AssetIndex;

typedef struct ParcelApiHeader {
  /**
   * `size_of::<ParcelApi>()` as the host was built. Always the first member.
   */
  uintptr_t size;
  /**
   * [`PARCEL_ABI_VERSION`] as the host was built.
   */
  uint32_t abi;
  /**
   * Room for a minor version, should appended functions ever need to be
   * detectable by something more readable than `size`.
   */
  uint32_t _reserved;
} ParcelApiHeader;

/**
 * Byte buffer owned by Parcel.
 * Plugins may allocate a buffer with `parcel_buffer_alloc` and release with `parcel_free_buffer()`.
 * Use `parcel_buffer_write` or `parcel_buffer_write_utf8` to copy data into an existing Buffer,
 * replacing and dropping the existing content if any. Do not set the fields in this struct manually.
 */
typedef struct Buffer {
  uint8_t *data;
  uintptr_t len;
  uintptr_t cap;
  bool is_utf8;
} Buffer;

/**
 * Opaque handle to a Parcel asset. Pass to `parcel_asset_*` functions.
 */
typedef uint64_t Asset;

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
 * Opaque handle to Parcel bundle graph.
 */
typedef uint64_t BundleGraph;

/**
 * Opaque handle to Parcel bundle.
 */
typedef uint64_t Bundle;

/**
 * Opaque handle to Parcel build options. Passed to all plugin entry points.
 */
typedef uint64_t Options;

/**
 * Opaque handle to a Parcel target. Obtained via `parcel_asset_get_target()`.
 */
typedef uint64_t Target;

/**
 * Index of a bundle within the bundle graph.
 */
typedef uintptr_t BundleIndex;

typedef struct BundleGraphDependencyResolution {
  /**
   * `PARCEL_BUNDLE_GRAPH_RESOLUTION_*`
   */
  BundleGraphResolutionType resolution_type;
  /**
   * Valid only when `resolution_type == PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET`.
   */
  AssetIndex asset;
  /**
   * Valid only when `resolution_type == PARCEL_BUNDLE_GRAPH_RESOLUTION_BUNDLE`.
   */
  BundleIndex bundle;
} BundleGraphDependencyResolution;

/**
 * Opaque handle to a Parcel dependency. Passed to `parcel_plugin_resolve()`.
 */
typedef uint64_t Dependency;

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
  /**
   * `PARCEL_EXPORTS_CONDITION_*` bits
   */
  ExportsConditions conditions;
} DependencyOptions;

/**
 * The host functions available to a plugin.
 */
typedef struct ParcelApi {
  /**
   * Size and abi version. Always the first member.
   */
  struct ParcelApiHeader header;
  void (*asset_get_content)(struct Buffer *buf, Asset asset);
  void (*asset_get_content_utf8)(struct Buffer *buf, Asset asset);
  void (*asset_set_content)(Asset asset, const uint8_t *data, uint32_t len);
  void (*asset_set_content_utf8)(Asset asset, const uint8_t *data, uint32_t len);
  void (*asset_set_custom_content)(Asset asset,
                                   const uint8_t (*ty)[16],
                                   void *content,
                                   void (*read)(const void *content,
                                                struct Buffer *buf,
                                                struct Diagnostic *diagnostic),
                                   void (*package)(const void *content,
                                                   BundleGraph bundle_graph,
                                                   Bundle bundle,
                                                   Options options,
                                                   struct Buffer *buf,
                                                   struct Diagnostic *diagnostic),
                                   void (*free)(void *content));
  bool (*asset_get_custom_content)(uint8_t (*ty)[16], void **content, Asset asset);
  void (*asset_get_type)(struct Buffer *buf, Asset asset);
  void (*asset_set_type)(Asset asset, const uint8_t *ty, uintptr_t ty_len);
  void (*asset_get_file_path)(struct Buffer *buf, Asset asset, Options _options);
  void (*asset_get_pipeline)(struct Buffer *buf, Asset asset);
  void (*asset_set_pipeline)(Asset asset, const uint8_t *pipeline, uintptr_t pipeline_len);
  BundleBehavior (*asset_get_bundle_behavior)(Asset asset);
  void (*asset_set_bundle_behavior)(Asset asset, BundleBehavior behavior);
  AssetFlags (*asset_get_flags)(Asset asset);
  void (*asset_set_flags)(Asset asset, AssetFlags flags);
  void (*asset_get_unique_key)(struct Buffer *buf, Asset asset);
  void (*asset_set_unique_key)(Asset asset, const uint8_t *key, uintptr_t key_len);
  void (*asset_add_export_symbol)(Asset asset, const uint8_t *name, uintptr_t name_len);
  void (*free_buffer)(struct Buffer *buf);
  struct Buffer (*buffer_alloc)(const uint8_t *data, uintptr_t len);
  void (*buffer_write)(struct Buffer *buf, const uint8_t *data, uintptr_t len);
  void (*buffer_write_utf8)(struct Buffer *buf, const uint8_t *data, uintptr_t len);
  void (*bundle_get_type)(struct Buffer *buf, Bundle bundle);
  Target (*bundle_get_target)(Bundle bundle);
  BundleBehavior (*bundle_get_bundle_behavior)(Bundle bundle);
  BundleFlags (*bundle_get_flags)(Bundle bundle);
  void (*bundle_get_dist_path)(struct Buffer *buf, Bundle bundle);
  uintptr_t (*bundle_get_asset_count)(Bundle bundle);
  AssetIndex (*bundle_get_asset)(Bundle bundle, uintptr_t index);
  uintptr_t (*bundle_get_entry_asset_count)(Bundle bundle);
  AssetIndex (*bundle_get_entry_asset)(Bundle bundle, uintptr_t index);
  AssetIndex (*bundle_get_main_entry_asset)(Bundle bundle);
  void (*bundle_get_name)(struct Buffer *buf, Bundle bundle);
  void (*bundle_get_absolute_url)(struct Buffer *buf, Bundle bundle);
  void (*bundle_get_relative_url)(struct Buffer *buf, Bundle bundle, Bundle from);
  void (*bundle_get_relative_specifier)(struct Buffer *buf, Bundle bundle, Bundle from);
  uintptr_t (*bundle_graph_get_asset_count)(BundleGraph bundle_graph);
  Asset (*bundle_graph_get_asset)(BundleGraph bundle_graph, AssetIndex index);
  uintptr_t (*bundle_graph_get_bundle_count)(BundleGraph bundle_graph);
  Bundle (*bundle_graph_get_bundle)(BundleGraph bundle_graph, BundleIndex index);
  struct BundleGraphDependencyResolution (*bundle_graph_get_dependency_resolution)(BundleGraph bundle_graph,
                                                                                   AssetIndex asset,
                                                                                   uintptr_t dependency_index);
  uintptr_t (*asset_get_dependency_count)(Asset asset);
  Dependency (*asset_get_dependency)(Asset asset, uintptr_t index);
  void (*asset_add_dependency)(Asset asset, const struct DependencyOptions *dep);
  void (*dep_get_specifier)(struct Buffer *buf, Dependency dep);
  SpecifierType (*dep_get_specifier_type)(Dependency dep);
  Priority (*dep_get_priority)(Dependency dep);
  BundleBehavior (*dep_get_bundle_behavior)(Dependency dep);
  DependencyFlags (*dep_get_flags)(Dependency dep);
  ExportsConditions (*dep_get_conditions)(Dependency dep);
  void (*dep_get_source_path)(struct Buffer *buf, Dependency dep, Options _options);
  void (*dep_get_resolve_from)(struct Buffer *buf, Dependency dep, Options _options);
  Target (*dep_get_target)(Dependency dep);
  void (*options_get_project_root)(struct Buffer *buf, Options options);
  void (*options_get_env)(struct Buffer *buf, Options options, const uint8_t *key, uintptr_t key_len);
  Target (*asset_get_target)(Asset asset);
  Environment (*target_get_environment)(Target target);
  OutputFormat (*target_get_output_format)(Target target);
  SourceType (*target_get_source_type)(Target target);
  EnvironmentFlags (*target_get_env_flags)(Target target);
  void (*target_get_public_url)(struct Buffer *buf, Target target);
  void (*target_get_dist_dir)(struct Buffer *buf, Target target, Options _options);
  void (*asset_get_query)(struct Buffer *buf, Asset asset);
} ParcelApi;

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

/**
 * Result filled by an optimizer plugin's `parcel_plugin_optimize()`.
 * The struct is zero-initialised by the host before the call. Fill `contents`
 * and optionally `source_map` using `parcel_buffer_write()` or
 * `parcel_buffer_write_utf8()`.
 */
typedef struct OptimizeResult {
  struct Buffer contents;
  /**
   * Leave empty to remove the source map from the optimized output.
   */
  struct Buffer source_map;
} OptimizeResult;

#define PARCEL_INVALID_ASSET_INDEX 4294967295


/**
 * The host functions Parcel passed to `parcel_plugin_init()`. Plugins define this
 * once and assign it before calling anything below.
 */
extern const struct ParcelApi *parcel_api;

/**
 * Whether `api` is usable by a plugin built against this header. Check it in
 * `parcel_plugin_init()` before anything else.
 *
 * Two things have to hold. The ABI version must match: appending never changes
 * the size of an existing field, so a changed signature is invisible to the size
 * check. And the table must be at least as large as the one declared here, so
 * every function the plugin can reach has been filled in.
 */
static inline bool parcel_api_compatible(const struct ParcelApiHeader *api) {
  return api && api->abi == PARCEL_ABI_VERSION &&
         api->size >= sizeof(struct ParcelApi);
}

static inline void parcel_asset_get_content(struct Buffer *buf, Asset asset) {
  parcel_api->asset_get_content(buf, asset);
}

static inline void parcel_asset_get_content_utf8(struct Buffer *buf, Asset asset) {
  parcel_api->asset_get_content_utf8(buf, asset);
}

static inline void parcel_asset_set_content(Asset asset, const uint8_t *data, uint32_t len) {
  parcel_api->asset_set_content(asset, data, len);
}

static inline void parcel_asset_set_content_utf8(Asset asset, const uint8_t *data, uint32_t len) {
  parcel_api->asset_set_content_utf8(asset, data, len);
}

static inline void parcel_asset_set_custom_content(Asset asset, const uint8_t (*ty)[16], void *content, void (*read)(const void *content, struct Buffer *buf, struct Diagnostic *diagnostic), void (*package)(const void *content, BundleGraph bundle_graph, Bundle bundle, Options options, struct Buffer *buf, struct Diagnostic *diagnostic), void (*free)(void *content)) {
  parcel_api->asset_set_custom_content(asset, ty, content, read, package, free);
}

static inline bool parcel_asset_get_custom_content(uint8_t (*ty)[16], void **content, Asset asset) {
  return parcel_api->asset_get_custom_content(ty, content, asset);
}

static inline void parcel_asset_get_type(struct Buffer *buf, Asset asset) {
  parcel_api->asset_get_type(buf, asset);
}

static inline void parcel_asset_set_type(Asset asset, const uint8_t *ty, uintptr_t ty_len) {
  parcel_api->asset_set_type(asset, ty, ty_len);
}

static inline void parcel_asset_get_file_path(struct Buffer *buf, Asset asset, Options _options) {
  parcel_api->asset_get_file_path(buf, asset, _options);
}

static inline void parcel_asset_get_pipeline(struct Buffer *buf, Asset asset) {
  parcel_api->asset_get_pipeline(buf, asset);
}

static inline void parcel_asset_set_pipeline(Asset asset, const uint8_t *pipeline, uintptr_t pipeline_len) {
  parcel_api->asset_set_pipeline(asset, pipeline, pipeline_len);
}

static inline BundleBehavior parcel_asset_get_bundle_behavior(Asset asset) {
  return parcel_api->asset_get_bundle_behavior(asset);
}

static inline void parcel_asset_set_bundle_behavior(Asset asset, BundleBehavior behavior) {
  parcel_api->asset_set_bundle_behavior(asset, behavior);
}

static inline AssetFlags parcel_asset_get_flags(Asset asset) {
  return parcel_api->asset_get_flags(asset);
}

static inline void parcel_asset_set_flags(Asset asset, AssetFlags flags) {
  parcel_api->asset_set_flags(asset, flags);
}

static inline void parcel_asset_get_unique_key(struct Buffer *buf, Asset asset) {
  parcel_api->asset_get_unique_key(buf, asset);
}

static inline void parcel_asset_set_unique_key(Asset asset, const uint8_t *key, uintptr_t key_len) {
  parcel_api->asset_set_unique_key(asset, key, key_len);
}

static inline void parcel_asset_add_export_symbol(Asset asset, const uint8_t *name, uintptr_t name_len) {
  parcel_api->asset_add_export_symbol(asset, name, name_len);
}

static inline void parcel_free_buffer(struct Buffer *buf) {
  parcel_api->free_buffer(buf);
}

static inline struct Buffer parcel_buffer_alloc(const uint8_t *data, uintptr_t len) {
  return parcel_api->buffer_alloc(data, len);
}

static inline void parcel_buffer_write(struct Buffer *buf, const uint8_t *data, uintptr_t len) {
  parcel_api->buffer_write(buf, data, len);
}

static inline void parcel_buffer_write_utf8(struct Buffer *buf, const uint8_t *data, uintptr_t len) {
  parcel_api->buffer_write_utf8(buf, data, len);
}

static inline void parcel_bundle_get_type(struct Buffer *buf, Bundle bundle) {
  parcel_api->bundle_get_type(buf, bundle);
}

static inline Target parcel_bundle_get_target(Bundle bundle) {
  return parcel_api->bundle_get_target(bundle);
}

static inline BundleBehavior parcel_bundle_get_bundle_behavior(Bundle bundle) {
  return parcel_api->bundle_get_bundle_behavior(bundle);
}

static inline BundleFlags parcel_bundle_get_flags(Bundle bundle) {
  return parcel_api->bundle_get_flags(bundle);
}

static inline void parcel_bundle_get_dist_path(struct Buffer *buf, Bundle bundle) {
  parcel_api->bundle_get_dist_path(buf, bundle);
}

static inline uintptr_t parcel_bundle_get_asset_count(Bundle bundle) {
  return parcel_api->bundle_get_asset_count(bundle);
}

static inline AssetIndex parcel_bundle_get_asset(Bundle bundle, uintptr_t index) {
  return parcel_api->bundle_get_asset(bundle, index);
}

static inline uintptr_t parcel_bundle_get_entry_asset_count(Bundle bundle) {
  return parcel_api->bundle_get_entry_asset_count(bundle);
}

static inline AssetIndex parcel_bundle_get_entry_asset(Bundle bundle, uintptr_t index) {
  return parcel_api->bundle_get_entry_asset(bundle, index);
}

static inline AssetIndex parcel_bundle_get_main_entry_asset(Bundle bundle) {
  return parcel_api->bundle_get_main_entry_asset(bundle);
}

static inline void parcel_bundle_get_name(struct Buffer *buf, Bundle bundle) {
  parcel_api->bundle_get_name(buf, bundle);
}

static inline void parcel_bundle_get_absolute_url(struct Buffer *buf, Bundle bundle) {
  parcel_api->bundle_get_absolute_url(buf, bundle);
}

static inline void parcel_bundle_get_relative_url(struct Buffer *buf, Bundle bundle, Bundle from) {
  parcel_api->bundle_get_relative_url(buf, bundle, from);
}

static inline void parcel_bundle_get_relative_specifier(struct Buffer *buf, Bundle bundle, Bundle from) {
  parcel_api->bundle_get_relative_specifier(buf, bundle, from);
}

static inline uintptr_t parcel_bundle_graph_get_asset_count(BundleGraph bundle_graph) {
  return parcel_api->bundle_graph_get_asset_count(bundle_graph);
}

static inline Asset parcel_bundle_graph_get_asset(BundleGraph bundle_graph, AssetIndex index) {
  return parcel_api->bundle_graph_get_asset(bundle_graph, index);
}

static inline uintptr_t parcel_bundle_graph_get_bundle_count(BundleGraph bundle_graph) {
  return parcel_api->bundle_graph_get_bundle_count(bundle_graph);
}

static inline Bundle parcel_bundle_graph_get_bundle(BundleGraph bundle_graph, BundleIndex index) {
  return parcel_api->bundle_graph_get_bundle(bundle_graph, index);
}

static inline struct BundleGraphDependencyResolution parcel_bundle_graph_get_dependency_resolution(BundleGraph bundle_graph, AssetIndex asset, uintptr_t dependency_index) {
  return parcel_api->bundle_graph_get_dependency_resolution(bundle_graph, asset, dependency_index);
}

static inline uintptr_t parcel_asset_get_dependency_count(Asset asset) {
  return parcel_api->asset_get_dependency_count(asset);
}

static inline Dependency parcel_asset_get_dependency(Asset asset, uintptr_t index) {
  return parcel_api->asset_get_dependency(asset, index);
}

static inline void parcel_asset_add_dependency(Asset asset, const struct DependencyOptions *dep) {
  parcel_api->asset_add_dependency(asset, dep);
}

static inline void parcel_dep_get_specifier(struct Buffer *buf, Dependency dep) {
  parcel_api->dep_get_specifier(buf, dep);
}

static inline SpecifierType parcel_dep_get_specifier_type(Dependency dep) {
  return parcel_api->dep_get_specifier_type(dep);
}

static inline Priority parcel_dep_get_priority(Dependency dep) {
  return parcel_api->dep_get_priority(dep);
}

static inline BundleBehavior parcel_dep_get_bundle_behavior(Dependency dep) {
  return parcel_api->dep_get_bundle_behavior(dep);
}

static inline DependencyFlags parcel_dep_get_flags(Dependency dep) {
  return parcel_api->dep_get_flags(dep);
}

static inline ExportsConditions parcel_dep_get_conditions(Dependency dep) {
  return parcel_api->dep_get_conditions(dep);
}

static inline void parcel_dep_get_source_path(struct Buffer *buf, Dependency dep, Options _options) {
  parcel_api->dep_get_source_path(buf, dep, _options);
}

static inline void parcel_dep_get_resolve_from(struct Buffer *buf, Dependency dep, Options _options) {
  parcel_api->dep_get_resolve_from(buf, dep, _options);
}

static inline Target parcel_dep_get_target(Dependency dep) {
  return parcel_api->dep_get_target(dep);
}

static inline void parcel_options_get_project_root(struct Buffer *buf, Options options) {
  parcel_api->options_get_project_root(buf, options);
}

static inline void parcel_options_get_env(struct Buffer *buf, Options options, const uint8_t *key, uintptr_t key_len) {
  parcel_api->options_get_env(buf, options, key, key_len);
}

static inline Target parcel_asset_get_target(Asset asset) {
  return parcel_api->asset_get_target(asset);
}

static inline Environment parcel_target_get_environment(Target target) {
  return parcel_api->target_get_environment(target);
}

static inline OutputFormat parcel_target_get_output_format(Target target) {
  return parcel_api->target_get_output_format(target);
}

static inline SourceType parcel_target_get_source_type(Target target) {
  return parcel_api->target_get_source_type(target);
}

static inline EnvironmentFlags parcel_target_get_env_flags(Target target) {
  return parcel_api->target_get_env_flags(target);
}

static inline void parcel_target_get_public_url(struct Buffer *buf, Target target) {
  parcel_api->target_get_public_url(buf, target);
}

static inline void parcel_target_get_dist_dir(struct Buffer *buf, Target target, Options _options) {
  parcel_api->target_get_dist_dir(buf, target, _options);
}

static inline void parcel_asset_get_query(struct Buffer *buf, Asset asset) {
  parcel_api->asset_get_query(buf, asset);
}

#endif  /* PARCEL_PLUGIN_H */
