// go build -o goplugin.dylib -buildmode=c-shared plugin.go
package main

/*
#define PARCEL_OMIT_ENTRY_POINTS
#include "crates/parcel-plugin-abi/plugin.h"

// The single definition of the table declared by plugin.h, which its
// parcel_asset_get_content() and friends call through.
//
// It is weak because this file has //export directives, so cgo copies the
// preamble into more than one translation unit and a strong definition would be
// duplicated. The Go SDK puts it in its own .c file instead; that is the more
// portable choice, and the one to copy for anything beyond a single-file demo.
__attribute__((weak)) const struct ParcelApi *parcel_api = 0;
*/
import "C"
import (
	"strings"
	"unsafe"
)

type Asset C.Asset

func (a Asset) Content() string {
	var buf C.Buffer
	C.parcel_asset_get_content(&buf, C.Asset(a))
	if buf.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(&buf)
	return C.GoStringN((*C.char)(unsafe.Pointer(buf.data)), C.int(buf.len))
}

func (a Asset) SetContent(content string) {
	ptr := unsafe.StringData(content)
	C.parcel_asset_set_content(C.Asset(a), (*C.uint8_t)(ptr), C.uint32_t(len(content)))
}

func (a Asset) SetType(assetType string) {
	if len(assetType) == 0 {
		return
	}
	ptr := (*C.uint8_t)(unsafe.Pointer(unsafe.StringData(assetType)))
	C.parcel_asset_set_type(C.Asset(a), ptr, C.uintptr_t(len(assetType)))
}

//export parcel_plugin_init
func parcel_plugin_init(api *C.struct_ParcelApi, config *C.uint8_t, configLen C.uintptr_t, outState *unsafe.Pointer, diag *C.Diagnostic) C.InitStatus {
	// ParcelApi only ever grows, so a table at least as large as the one this
	// plugin was compiled against has every field the plugin can reach. Checking
	// it here is what makes every call below safe.
	//
	// Report the mismatch rather than describing it: writing a diagnostic means
	// allocating through the table we just rejected. Parcel writes that message.
	// Checked through the header rather than the whole struct: an older Parcel's
	// table is genuinely shorter than this one, so api may not point at a
	// complete struct ParcelApi until the size in its header says so.
	if api == nil || !C.parcel_api_compatible(&api.header) {
		return C.InitStatus(C.PARCEL_INIT_INCOMPATIBLE)
	}
	C.parcel_api = api

	// This plugin keeps no state, so outState is left as Parcel initialized it.
	return C.InitStatus(C.PARCEL_INIT_OK)
}

//export parcel_plugin_transform
func parcel_plugin_transform(cAsset C.Asset, options C.Options, state unsafe.Pointer, diag *C.Diagnostic) {
	_ = options
	_ = state
	_ = diag
	asset := Asset(cAsset)
	content := asset.Content()
	asset.SetContent("export default 'from Go: " + strings.ToUpper(content) + "';")
	asset.SetType("js")
}

func main() {}
