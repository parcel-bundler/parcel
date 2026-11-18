//go:build parceltest

// The package's test helpers, behind a build tag so that they, and the mock host
// in their cgo preamble, are not compiled into every plugin. They cannot live in
// _test.go files, which cannot use cgo. Run the tests with:
//
//	go test -tags parceltest ./...

package parcel

/*
#include <stdlib.h>
#include <string.h>
#include "plugin.h"

// The asset handle the mock host below has a source map for. Any other handle
// has none.
#define TEST_MAPPED_ASSET 1
#define TEST_SOURCE_MAP "{\"version\":3,\"sources\":[\"a.ts\"],\"mappings\":\"AAAA\"}"

static void test_asset_get_map(struct Buffer *buf, Asset asset) {
  if (asset != TEST_MAPPED_ASSET) {
    return;
  }
  size_t len = strlen(TEST_SOURCE_MAP);
  buf->data = malloc(len);
  memcpy(buf->data, TEST_SOURCE_MAP, len);
  buf->len = len;
  buf->cap = len;
}

static void test_buffer_free(struct Buffer *buf) {
  free(buf->data);
  buf->data = NULL;
}

static void install_source_map_api(struct ParcelApi *api) {
  api->asset_get_map = test_asset_get_map;
  api->buffer_free = test_buffer_free;
}

// What the sized-struct host below was last passed: the size of each struct, and
// the specifier of the last dependency.
static uintptr_t test_dependency_size, test_resolve_result_size, test_resolution_size, test_diagnostic_size,
    test_engines_size;
static char test_specifier[64];

// Go cannot reference static variables, only functions.
static uintptr_t test_get_dependency_size(void) { return test_dependency_size; }
static uintptr_t test_get_resolve_result_size(void) { return test_resolve_result_size; }
static uintptr_t test_get_resolution_size(void) { return test_resolution_size; }
static uintptr_t test_get_diagnostic_size(void) { return test_diagnostic_size; }
static uintptr_t test_get_engines_size(void) { return test_engines_size; }
static const char *test_get_specifier(void) { return test_specifier; }

static struct Buffer test_buffer_alloc(const uint8_t *data, uintptr_t len) {
  struct Buffer buf = {0};
  buf.data = malloc(len);
  memcpy(buf.data, data, len);
  buf.len = len;
  buf.cap = len;
  return buf;
}

// Rejects a dependency added to asset 0, and accepts it on any other.
static bool test_asset_add_dependency(Asset asset, const struct DependencyOptions *dep) {
  test_dependency_size = dep->size;
  size_t len = dep->specifier_len < sizeof(test_specifier) - 1 ? dep->specifier_len : sizeof(test_specifier) - 1;
  memcpy(test_specifier, dep->specifier, len);
  test_specifier[len] = 0;
  return asset != 0;
}

// The diagnostics list the host below hands out when a resolve fails, whose one
// diagnostic says TEST_RESOLVE_FAILURE.
#define TEST_FAILED_ASSET 99
#define TEST_RESOLVE_DIAGNOSTICS 7
#define TEST_RESOLVE_FAILURE "the resolver failed"

// Resolves to the ResolutionType given as the asset handle, with a file path. The
// asset TEST_FAILED_ASSET fails, handing out TEST_RESOLVE_DIAGNOSTICS.
static bool test_asset_resolve(Asset asset, Options options, const struct DependencyOptions *dep,
                               const uint8_t *from, uintptr_t from_len, struct ResolveResult *result,
                               Diagnostics *diagnostics) {
  test_dependency_size = dep->size;
  test_resolve_result_size = result->size;
  if (asset == TEST_FAILED_ASSET) {
    *diagnostics = TEST_RESOLVE_DIAGNOSTICS;
    return false;
  }
  result->resolution_type = (ResolutionType)asset;
  result->file_path = test_buffer_alloc((const uint8_t *)"/a.js", 5);
  return true;
}

static void test_diagnostic_get_message(struct Buffer *buf, DiagnosticsRef diagnostics, uintptr_t index) {
  if (diagnostics == TEST_RESOLVE_DIAGNOSTICS && index == 0) {
    *buf = test_buffer_alloc((const uint8_t *)TEST_RESOLVE_FAILURE, strlen(TEST_RESOLVE_FAILURE));
  }
}

// Resolves to the BundleGraphResolutionType given as the asset index.
static void test_bundle_graph_get_dependency_resolution(struct BundleGraphDependencyResolution *resolution,
                                                        BundleGraph bundle_graph, AssetIndex asset,
                                                        uintptr_t dependency_index) {
  test_resolution_size = resolution->size;
  resolution->resolution_type = (BundleGraphResolutionType)asset;
  resolution->asset = 5;
  resolution->bundle = 6;
}

// Supports Chrome 100, Safari 15.4 and Node 18.2.
static void test_target_get_engines(struct Engines *engines, Target target) {
  test_engines_size = engines->size;
  engines->chrome = 100 << 8;
  engines->safari = 15 << 8 | 4;
  engines->node = 18 << 8 | 2;
}

static void test_options_log_diagnostic(Options options, const struct DiagnosticOptions *diagnostic) {
  test_diagnostic_size = diagnostic->size;
}

// The one diagnostics list the host below hands out, both in the out-params
// sizedDiagnostic returns and from diagnostics_create. It records the sizes of
// the structs a plugin builds a diagnostic with, and the last diagnostic pushed
// to it.
#define TEST_DIAGNOSTICS_LIST 11
static size_t test_entry_size, test_frame_size, test_highlight_size;
static int test_pushed_count, test_frame_count, test_hint_count;
static uint32_t test_highlight_end_line, test_highlight_end_column;
static char test_pushed_message[256], test_highlight_message[256], test_documentation_url[256];
static size_t test_get_entry_size(void) { return test_entry_size; }
static size_t test_get_frame_size(void) { return test_frame_size; }
static size_t test_get_highlight_size(void) { return test_highlight_size; }
static int test_get_pushed_count(void) { return test_pushed_count; }
static const char *test_get_pushed_message(void) { return test_pushed_message; }
static uint32_t test_get_highlight_end_line(void) { return test_highlight_end_line; }
static uint32_t test_get_highlight_end_column(void) { return test_highlight_end_column; }
static const char *test_get_highlight_message(void) { return test_highlight_message; }
static const char *test_get_documentation_url(void) { return test_documentation_url; }

static void test_copy_string(char *dst, size_t cap, const uint8_t *src, uintptr_t len) {
  size_t n = len < cap - 1 ? len : cap - 1;
  if (n) memcpy(dst, src, n);
  dst[n] = 0;
}

static void test_reset_diagnostics(void) {
  test_entry_size = test_frame_size = test_highlight_size = 0;
  test_pushed_count = test_frame_count = test_hint_count = 0;
  test_highlight_end_line = test_highlight_end_column = 0;
  test_pushed_message[0] = test_highlight_message[0] = test_documentation_url[0] = 0;
}

static Diagnostics test_diagnostics_create(Options options) { return TEST_DIAGNOSTICS_LIST; }

static bool test_diagnostics_push(Diagnostics list, const struct DiagnosticEntryOptions *diagnostic) {
  if (list != TEST_DIAGNOSTICS_LIST || diagnostic->message_len == 0) return false;
  test_entry_size = diagnostic->size;
  test_pushed_count++;
  test_frame_count = test_hint_count = 0;
  test_copy_string(test_pushed_message, sizeof(test_pushed_message), diagnostic->message, diagnostic->message_len);
  test_copy_string(test_documentation_url, sizeof(test_documentation_url), diagnostic->documentation_url,
                   diagnostic->documentation_url_len);
  return true;
}

static bool test_diagnostics_add_code_frame(Diagnostics list, const struct CodeFrameOptions *frame) {
  test_frame_size = frame->size;
  test_frame_count++;
  return list == TEST_DIAGNOSTICS_LIST;
}

static bool test_diagnostics_add_code_highlight(Diagnostics list, const struct CodeHighlightOptions *highlight) {
  test_highlight_size = highlight->size;
  test_highlight_end_line = highlight->end_line;
  test_highlight_end_column = highlight->end_column;
  test_copy_string(test_highlight_message, sizeof(test_highlight_message), highlight->message, highlight->message_len);
  return list == TEST_DIAGNOSTICS_LIST;
}

static bool test_diagnostics_add_hint(Diagnostics list, const uint8_t *hint, uintptr_t hint_len) {
  test_hint_count++;
  return list == TEST_DIAGNOSTICS_LIST;
}

// The host function a plugin last called to hand over content or a name.
static const char *test_last_call = "";
static const char *test_get_last_call(void) { return test_last_call; }

// Records "+map" after the setter's name when it was given a source map.
static void test_set_content(Asset asset, const uint8_t *data, uintptr_t len,
                             const uint8_t *map, uintptr_t map_len) {
  test_last_call = map ? "asset_set_content+map" : "asset_set_content";
}
static void test_set_content_utf8(Asset asset, const uint8_t *data, uintptr_t len,
                                  const uint8_t *map, uintptr_t map_len) {
  test_last_call = map ? "asset_set_content_utf8+map" : "asset_set_content_utf8";
}
static void test_buffer_write(struct Buffer *buf, const uint8_t *data, uintptr_t len) {
  test_last_call = "buffer_write";
}
static void test_buffer_write_utf8(struct Buffer *buf, const uint8_t *data, uintptr_t len) {
  test_last_call = "buffer_write_utf8";
}

static void install_utf8_api(struct ParcelApi *api) {
  test_last_call = "";
  api->asset_set_content = test_set_content;
  api->asset_set_content_utf8 = test_set_content_utf8;
  api->buffer_write = test_buffer_write;
  api->buffer_write_utf8 = test_buffer_write_utf8;
}

// A host whose answers are read from the handles they're given: a dependency's
// import type is its handle, an asset has as many dependencies as its handle,
// each the handle 100 + its index, and the options handle is the log level, with
// HMR enabled for PARCEL_LOG_VERBOSE.
static ImportType test_dep_get_import_type(Dependency dep) { return (ImportType)dep; }
static uintptr_t test_asset_get_dependency_count(AssetRef asset) { return (uintptr_t)asset; }
static Dependency test_asset_get_dependency(AssetRef asset, uintptr_t index) {
  return index < (uintptr_t)asset ? 100 + index : 0;
}
static void test_options_get_mode(struct Buffer *buf, Options options) {
  *buf = test_buffer_alloc((const uint8_t *)"staging", 7);
}
static bool test_options_get_hmr(Options options) { return options == PARCEL_LOG_VERBOSE; }
static LogLevel test_options_get_log_level(Options options) { return (LogLevel)options; }

static void install_accessor_api(struct ParcelApi *api) {
  api->buffer_free = test_buffer_free;
  api->dep_get_import_type = test_dep_get_import_type;
  api->asset_get_dependency_count = test_asset_get_dependency_count;
  api->asset_get_dependency = test_asset_get_dependency;
  api->options_get_mode = test_options_get_mode;
  api->options_get_hmr = test_options_get_hmr;
  api->options_get_log_level = test_options_get_log_level;
}

static void install_sized_struct_api(struct ParcelApi *api) {
  api->buffer_free = test_buffer_free;
  api->buffer_alloc = test_buffer_alloc;
  api->asset_add_dependency = test_asset_add_dependency;
  api->asset_resolve = test_asset_resolve;
  api->diagnostic_get_message = test_diagnostic_get_message;
  api->bundle_graph_get_dependency_resolution = test_bundle_graph_get_dependency_resolution;
  api->target_get_engines = test_target_get_engines;
  api->options_log_diagnostic = test_options_log_diagnostic;
  api->diagnostics_create = test_diagnostics_create;
  api->diagnostics_push = test_diagnostics_push;
  api->diagnostics_add_code_frame = test_diagnostics_add_code_frame;
  api->diagnostics_add_code_highlight = test_diagnostics_add_code_highlight;
  api->diagnostics_add_hint = test_diagnostics_add_hint;
  test_reset_diagnostics();
}
*/
import "C"

import (
	"runtime/cgo"
	"unsafe"
)

// hostAPI allocates a host function table matching what this SDK was built
// against, as Parcel would pass to parcel_plugin_init2. sizeDelta and abiDelta
// adjust the reported size and ABI version to stand in for a Parcel that appended
// functions or made a breaking change. The function pointers are left nil.
//
// This exists for the package's own tests, which cannot construct C types
// themselves: cgo is not supported in _test.go files.
func hostAPI(sizeDelta, abiDelta int) *C.struct_ParcelApi {
	api := (*C.struct_ParcelApi)(C.calloc(1, C.sizeof_struct_ParcelApi))
	api.header.size = C.uintptr_t(C.sizeof_struct_ParcelApi + sizeDelta)
	api.header.abi = C.uint32_t(C.PARCEL_ABI_VERSION + abiDelta)
	return api
}

// firstLayoutDelta is the sizeDelta for [hostAPI] that makes a table end where
// the first published layout does, as the oldest Parcel's would.
func firstLayoutDelta() int {
	return int(C.PARCEL_API_MIN_SIZE) - int(C.sizeof_struct_ParcelApi)
}

// freeHostAPI releases a table returned by [hostAPI].
func freeHostAPI(api *C.struct_ParcelApi) {
	C.free(unsafe.Pointer(api))
}

// initPlugin calls parcel_plugin_init2 as Parcel would, with api and an empty
// config, writing the plugin's state to state.
func initPlugin(api *C.struct_ParcelApi, state *unsafe.Pointer, diag *C.DiagnosticOptions) C.InitStatus {
	args := (*C.InitArgs)(C.calloc(1, C.sizeof_InitArgs))
	defer C.free(unsafe.Pointer(args))
	args.size = C.sizeof_InitArgs
	args.api = api
	return parcel_plugin_init2(args, state, diag)
}

// okStatus and incompatibleStatus expose the C enum values to tests, which
// cannot reference C types themselves.
func okStatus() C.InitStatus {
	return C.InitStatus(C.PARCEL_INIT_OK)
}

func incompatibleStatus() C.InitStatus {
	return C.InitStatus(C.PARCEL_INIT_INCOMPATIBLE)
}

// diagnosticWritten reports whether a plugin filled in a diagnostic: built one
// in the test host's list, or set the struct's own message.
func diagnosticWritten(diag *C.DiagnosticOptions) bool {
	if diag == nil {
		return false
	}
	if diag.diagnostics == C.TEST_DIAGNOSTICS_LIST {
		return C.test_get_pushed_count() > 0
	}
	return diag.message.data != nil
}

// testSourceMap is the map the host from [withSourceMapHost] returns for
// mappedAsset.
const testSourceMap = `{"version":3,"sources":["a.ts"],"mappings":"AAAA"}`

// withSourceMapHost runs body with parcel_api pointing at a host table that
// implements just asset_get_map and buffer_free, and passes it an asset that
// has a source map and one that has none.
func withSourceMapHost(body func(mappedAsset, unmappedAsset *Asset)) {
	api := hostAPI(0, 0)
	defer freeHostAPI(api)
	C.install_source_map_api(api)
	previous := C.parcel_api
	C.parcel_api = api
	defer func() { C.parcel_api = previous }()
	body(&Asset{ptr: C.TEST_MAPPED_ASSET}, &Asset{ptr: C.TEST_MAPPED_ASSET + 1})
}

// sizedHost reports what the host from [withSizedStructHost] was last passed:
// the size field of the last struct of each kind, and the last specifier.
type sizedHost struct{}

func (sizedHost) dependencySize() uintptr    { return uintptr(C.test_get_dependency_size()) }
func (sizedHost) resolveResultSize() uintptr { return uintptr(C.test_get_resolve_result_size()) }
func (sizedHost) resolutionSize() uintptr    { return uintptr(C.test_get_resolution_size()) }
func (sizedHost) diagnosticSize() uintptr    { return uintptr(C.test_get_diagnostic_size()) }
func (sizedHost) entrySize() uintptr         { return uintptr(C.test_get_entry_size()) }
func (sizedHost) frameSize() uintptr         { return uintptr(C.test_get_frame_size()) }
func (sizedHost) highlightSize() uintptr     { return uintptr(C.test_get_highlight_size()) }
func (sizedHost) enginesSize() uintptr       { return uintptr(C.test_get_engines_size()) }
func (sizedHost) specifier() string          { return C.GoString(C.test_get_specifier()) }

// The sizes this SDK was built with, which every struct it allocates must carry.
const (
	dependencyOptionsSize = C.sizeof_DependencyOptions
	resolveResultSize     = C.sizeof_ResolveResult
	resolutionSize        = C.sizeof_BundleGraphDependencyResolution
	diagnosticSize        = C.sizeof_DiagnosticOptions
	entrySize             = C.sizeof_DiagnosticEntryOptions
	frameSize             = C.sizeof_CodeFrameOptions
	highlightSize         = C.sizeof_CodeHighlightOptions
	enginesSize           = C.sizeof_Engines
	reportEventSize       = C.sizeof_ReportEvent
)

// reportEventMinSize is the smallest ReportEvent its first layout allows: up to the end of
// changed_asset_count.
var reportEventMinSize = unsafe.Offsetof(C.ReportEvent{}.changed_asset_count) + unsafe.Sizeof(C.ReportEvent{}.changed_asset_count)

// The C event types, for tests.
const (
	eventBuildStart = C.PARCEL_EVENT_BUILD_START
	eventLog        = C.PARCEL_EVENT_LOG
)

// withSizedStructHost runs body with parcel_api pointing at a host table that
// records the size of every struct a plugin passes it. Its add_dependency
// rejects a dependency added to the asset with handle 0. Its resolve answers
// with the ResolutionType given as the asset handle, and its dependency
// resolution with the BundleGraphResolutionType given as the asset index.
// Its diagnostic list builders record what a plugin builds, for
// [diagnosticMessage] and [rangeAndLinks] to read back.
func withSizedStructHost(body func(host sizedHost)) {
	api := hostAPI(0, 0)
	defer freeHostAPI(api)
	C.install_sized_struct_api(api)
	previous := C.parcel_api
	C.parcel_api = api
	defer func() { C.parcel_api = previous }()
	body(sizedHost{})
}

// failedAsset is an asset the host from [withSizedStructHost] fails to resolve
// for, with one diagnostic saying resolveFailure.
const (
	failedAsset    = C.TEST_FAILED_ASSET
	resolveFailure = C.TEST_RESOLVE_FAILURE
)

// withAccessorHost runs body with parcel_api pointing at a host table that
// answers from the handles it is given: see install_accessor_api.
func withAccessorHost(body func()) {
	api := hostAPI(0, 0)
	defer freeHostAPI(api)
	C.install_accessor_api(api)
	previous := C.parcel_api
	C.parcel_api = api
	defer func() { C.parcel_api = previous }()
	body()
}

// dependencyWithHandle, optionsWithHandle and assetRefWithHandle wrap raw
// handles, which the host from [withAccessorHost] reads as instructions.
func dependencyWithHandle(handle uint64) *Dependency { return &Dependency{ptr: C.Dependency(handle)} }
func optionsWithHandle(handle uint64) *Options       { return &Options{ptr: C.Options(handle)} }
func assetRefWithHandle(handle uint64) *AssetRef     { return &AssetRef{ptr: C.Asset(handle)} }

// targetWithHandle wraps a raw target handle.
func targetWithHandle(handle uint64) *Target { return &Target{ptr: C.Target(handle)} }

// rawDependency returns the handle a dependency wraps.
func rawDependency(dependency *Dependency) uint64 { return uint64(dependency.ptr) }

// parcelAPI returns the host table currently installed.
func parcelAPI() *C.struct_ParcelApi {
	return C.parcel_api
}

// assetWithHandle returns an asset with the raw handle, which the host above
// reads as an instruction.
func assetWithHandle(handle uint64) *Asset {
	return &Asset{ptr: C.Asset(handle)}
}

// sizedDiagnostic returns a zeroed Diagnostic whose size is set and whose list
// is the one the host from [withSizedStructHost] records, as Parcel passes one
// to an entry point, and a function that frees it.
func sizedDiagnostic(size uintptr) (*C.DiagnosticOptions, func()) {
	diag := (*C.DiagnosticOptions)(C.calloc(1, C.sizeof_DiagnosticOptions))
	diag.size = C.uintptr_t(size)
	diag.diagnostics = C.TEST_DIAGNOSTICS_LIST
	C.test_reset_diagnostics()
	return diag, func() {
		C.test_buffer_free(&diag.message)
		C.free(unsafe.Pointer(diag))
	}
}

// rangeAndLinks reports the end and message of the last highlight, and the
// documentation URL, of the diagnostic last built in the test host's list.
func rangeAndLinks() (endLine, endColumn uint32, highlightMessage, documentationURL string) {
	return uint32(C.test_get_highlight_end_line()), uint32(C.test_get_highlight_end_column()),
		C.GoString(C.test_get_highlight_message()), C.GoString(C.test_get_documentation_url())
}

// diagnosticMessage returns the message a plugin wrote to diag: of the
// diagnostic last built in the test host's list, or else the struct's own.
func diagnosticMessage(diag *C.DiagnosticOptions) string {
	if diag.diagnostics == C.TEST_DIAGNOSTICS_LIST && C.test_get_pushed_count() > 0 {
		return C.GoString(C.test_get_pushed_message())
	}
	return goString(unsafe.Pointer(diag.message.data), uintptr(diag.message.len))
}

// diagnosticSizeField returns the size a Diagnostic holds.
func diagnosticSizeField(diag *C.DiagnosticOptions) uintptr {
	return uintptr(diag.size)
}

// newReportEvent returns a zeroed event with the given size and type, as Parcel
// would pass to parcel_plugin_report, and a function that frees it.
func newReportEvent(size uintptr, eventType uint8) (*C.ReportEvent, func()) {
	event := (*C.ReportEvent)(C.calloc(1, C.sizeof_ReportEvent))
	event.size = C.uintptr_t(size)
	event.event_type = C.ReportEventType(eventType)
	return event, func() { C.free(unsafe.Pointer(event)) }
}

// withUTF8Host runs body with parcel_api pointing at a host table that records
// which content setter or buffer write a plugin last called, returned by
// lastCall: whether it handed the bytes over as UTF-8 or not.
func withUTF8Host(body func(lastCall func() string)) {
	api := hostAPI(0, 0)
	defer freeHostAPI(api)
	C.install_utf8_api(api)
	previous := C.parcel_api
	C.parcel_api = api
	defer func() { C.parcel_api = previous }()
	body(func() string { return C.GoString(C.test_get_last_call()) })
}

// pluginState returns the state parcel_plugin_init2 would produce for plugin,
// without installing a host table the way init does, and a function that frees
// it.
func pluginState(plugin any) (unsafe.Pointer, func()) {
	handle := cgo.NewHandle(plugin)
	state := (*C.uintptr_t)(C.malloc(C.size_t(unsafe.Sizeof(C.uintptr_t(0)))))
	*state = C.uintptr_t(handle)
	return unsafe.Pointer(state), func() {
		handle.Delete()
		C.free(unsafe.Pointer(state))
	}
}
