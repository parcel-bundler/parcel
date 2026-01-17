#include <stdint.h>

typedef uint64_t Asset;

typedef struct Buffer {
  uint8_t *data;
  uintptr_t len;
  uintptr_t cap;
} Buffer;

extern void parcel_asset_get_content(Buffer *buffer, Asset asset);
extern void parcel_asset_set_content(Asset asset, const uint8_t *data, uint32_t len);
extern void parcel_asset_set_type(Asset asset, const char *type);
extern void parcel_free_buffer(Buffer *buffer);
