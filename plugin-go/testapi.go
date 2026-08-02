package parcel

/*
#include <stdlib.h>
#include "plugin.h"
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
