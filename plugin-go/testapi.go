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

static void test_free_buffer(struct Buffer *buf) {
  free(buf->data);
  buf->data = NULL;
}

static void install_source_map_api(struct ParcelApi *api) {
  api->asset_get_map = test_asset_get_map;
  api->free_buffer = test_free_buffer;
}

// What the sized-struct host below was last passed: the size of each struct, and
// the specifier of the last dependency.
static uintptr_t test_dependency_size, test_resolve_result_size, test_resolution_size, test_diagnostic_size;
static char test_specifier[64];

// Go cannot reference static variables, only functions.
static uintptr_t test_get_dependency_size(void) { return test_dependency_size; }
static uintptr_t test_get_resolve_result_size(void) { return test_resolve_result_size; }
static uintptr_t test_get_resolution_size(void) { return test_resolution_size; }
static uintptr_t test_get_diagnostic_size(void) { return test_diagnostic_size; }
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

// Resolves to the ResolutionType given as the asset handle, with a file path.
static bool test_asset_resolve(Asset asset, Options options, const struct DependencyOptions *dep,
                               const uint8_t *from, uintptr_t from_len, struct ResolveResult *result) {
  test_dependency_size = dep->size;
  test_resolve_result_size = result->size;
  result->resolution_type = (ResolutionType)asset;
  result->file_path = test_buffer_alloc((const uint8_t *)"/a.js", 5);
  return true;
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

static void test_options_log_diagnostic(Options options, const struct Diagnostic *diagnostic) {
  test_diagnostic_size = diagnostic->size;
}

static void install_sized_struct_api(struct ParcelApi *api) {
  api->free_buffer = test_free_buffer;
  api->buffer_alloc = test_buffer_alloc;
  api->asset_add_dependency = test_asset_add_dependency;
  api->asset_resolve = test_asset_resolve;
  api->bundle_graph_get_dependency_resolution = test_bundle_graph_get_dependency_resolution;
  api->options_log_diagnostic = test_options_log_diagnostic;
}
*/
import "C"

import "unsafe"

// hostAPI allocates a host function table matching what this SDK was built
// against, as Parcel would pass to parcel_plugin_init. sizeDelta and abiDelta
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

// freeHostAPI releases a table returned by [hostAPI].
func freeHostAPI(api *C.struct_ParcelApi) {
	C.free(unsafe.Pointer(api))
}

// okStatus and incompatibleStatus expose the C enum values to tests, which
// cannot reference C types themselves.
func okStatus() C.InitStatus {
	return C.InitStatus(C.PARCEL_INIT_OK)
}

func incompatibleStatus() C.InitStatus {
	return C.InitStatus(C.PARCEL_INIT_INCOMPATIBLE)
}

// diagnosticWritten reports whether a plugin filled in a diagnostic.
func diagnosticWritten(diag *C.Diagnostic) bool {
	return diag != nil && diag.message.data != nil
}

// testSourceMap is the map the host from [withSourceMapHost] returns for
// mappedAsset.
const testSourceMap = `{"version":3,"sources":["a.ts"],"mappings":"AAAA"}`

// withSourceMapHost runs body with parcel_api pointing at a host table that
// implements just asset_get_map and free_buffer, and passes it an asset that
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
func (sizedHost) specifier() string          { return C.GoString(C.test_get_specifier()) }

// The sizes this SDK was built with, which every struct it allocates must carry.
const (
	dependencyOptionsSize = C.sizeof_DependencyOptions
	resolveResultSize     = C.sizeof_ResolveResult
	resolutionSize        = C.sizeof_BundleGraphDependencyResolution
	diagnosticSize        = C.sizeof_Diagnostic
	reportEventSize       = C.sizeof_ReportEvent
)

// reportEventMinSize is the smallest ReportEvent ABI 2 allows: up to the end of
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
func withSizedStructHost(body func(host sizedHost)) {
	api := hostAPI(0, 0)
	defer freeHostAPI(api)
	C.install_sized_struct_api(api)
	previous := C.parcel_api
	C.parcel_api = api
	defer func() { C.parcel_api = previous }()
	body(sizedHost{})
}

// parcelAPI returns the host table currently installed.
func parcelAPI() *C.struct_ParcelApi {
	return C.parcel_api
}

// assetWithHandle returns an asset with the raw handle, which the host above
// reads as an instruction.
func assetWithHandle(handle uint64) *Asset {
	return &Asset{ptr: C.Asset(handle)}
}

// sizedDiagnostic returns a zeroed Diagnostic whose size is set, as Parcel passes
// one to an entry point, and a function that frees it.
func sizedDiagnostic(size uintptr) (*C.Diagnostic, func()) {
	diag := (*C.Diagnostic)(C.calloc(1, C.sizeof_Diagnostic))
	diag.size = C.uintptr_t(size)
	return diag, func() {
		C.test_free_buffer(&diag.message)
		C.free(unsafe.Pointer(diag))
	}
}

// diagnosticSizeField returns the size a Diagnostic holds.
func diagnosticSizeField(diag *C.Diagnostic) uintptr {
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
