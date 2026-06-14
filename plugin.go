// go build -o goplugin.dylib -buildmode=c-shared plugin.go
package main

/*
#define PARCEL_OMIT_ENTRY_POINTS
#include "crates/parcel-plugin-abi/plugin.h"

#cgo darwin LDFLAGS: -Wl,-undefined,dynamic_lookup
#cgo linux  LDFLAGS: -Wl,--allow-shlib-undefined
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
