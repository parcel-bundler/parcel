#ifndef PARCEL_GO_BRIDGE_H
#define PARCEL_GO_BRIDGE_H

// See parcel.go: cgo declares the entry points itself.
#define PARCEL_NO_ENTRY_POINT_PROTOTYPES
#include "plugin.h"

void parcel_go_set_custom_content(Asset asset, const uint8_t *ty, void *content);
bool parcel_go_get_custom_content(uint8_t *ty, void **content, Asset asset);

#endif
