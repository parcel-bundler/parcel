#ifndef PARCEL_SWIFT_H
#define PARCEL_SWIFT_H

#include "plugin.h"

/// Assigns `parcel_api`. Swift cannot write a C global without tripping strict
/// concurrency checking, and every write here stores the same table anyway.
void parcel_swift_set_api(const struct ParcelApi *api);

#endif
