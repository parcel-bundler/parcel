package main

/*
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef uint64_t Asset;

typedef struct Buffer {
    uint8_t *data;
    uintptr_t len;
    uintptr_t cap;
} Buffer;

// These are the external C functions your Go code will call.
extern Buffer parcel_asset_get_content(Asset asset);
extern void parcel_asset_set_content(Asset asset, const uint8_t *data, uint32_t len);
extern void parcel_asset_set_type(Asset asset, const char *type);
extern void parcel_free_buffer(Buffer buffer);
*/
// #cgo LDFLAGS: -Wl,-undefined,dynamic_lookup
import "C"
import (
	"strings"
	"unsafe"
)

type Asset C.Asset

func (a Asset) Content() string {
	buffer := C.parcel_asset_get_content(C.Asset(a))
	if buffer.data == nil {
		return ""
	}
	defer C.parcel_free_buffer(buffer)
	
	return C.GoStringN((*C.char)(unsafe.Pointer(buffer.data)), C.int(buffer.len))
}

func (a Asset) SetContent(content string) {
	ptr := unsafe.StringData(content)
	C.parcel_asset_set_content(C.Asset(a), (*C.uint8_t)(ptr), C.uint32_t(len(content)))
}

func (a Asset) SetType(assetType string) {
	cStr := C.CString(assetType)
	defer C.free(unsafe.Pointer(cStr))
	
	C.parcel_asset_set_type(C.Asset(a), cStr)
}

//export parcel_plugin_transform
func parcel_plugin_transform(cAsset C.Asset) {
	asset := Asset(cAsset)

	content := asset.Content()
	transformed := "export default 'from Go: " + strings.ToUpper(content) + "';"

	asset.SetContent(transformed)
	asset.SetType("js")
}

func main() {}
