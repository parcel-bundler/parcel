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
