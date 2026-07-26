#include "bridge.h"

extern void parcel_go_content_read(void *content,
                                   struct Buffer *buf,
                                   struct Diagnostic *diagnostic);
extern void parcel_go_content_package(void *content,
                                      BundleGraph bundle_graph,
                                      Bundle bundle,
                                      Options options,
                                      struct Buffer *buf,
                                      struct Diagnostic *diagnostic);
extern void parcel_go_content_free(void *content);

void parcel_go_set_custom_content(Asset asset, const uint8_t *ty, void *content) {
  parcel_asset_set_custom_content(
      asset,
      (const uint8_t (*)[16])ty,
      content,
      (void (*)(const void *, struct Buffer *, struct Diagnostic *))parcel_go_content_read,
      (void (*)(const void *, BundleGraph, Bundle, Options, struct Buffer *,
                struct Diagnostic *))parcel_go_content_package,
      parcel_go_content_free);
}

bool parcel_go_get_custom_content(uint8_t *ty, void **content, Asset asset) {
  return parcel_asset_get_custom_content((uint8_t (*)[16])ty, content, asset);
}
