#include "plugin.h"

// The single definition of the host function table declared by plugin.h.
// parcel_plugin_init assigns it before any other entry point can run.
//
// It cannot live in parcel.go's cgo preamble: that file has //export directives,
// so cgo copies its preamble into more than one translation unit and a
// definition there would be duplicated.
const struct ParcelApi *parcel_api = 0;
