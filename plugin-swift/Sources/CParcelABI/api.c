#include "plugin.h"
#include "parcel_swift.h"

// The single definition of the host function table declared by plugin.h.
// parcel_plugin_init assigns it before any other entry point can run.
const struct ParcelApi *parcel_api = 0;

void parcel_swift_set_api(const struct ParcelApi *api) {
  parcel_api = api;
}
