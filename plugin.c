// A transformer written directly against the C ABI, without an SDK.
//
//   cc -shared -o plugin.dylib plugin.c

#include <string.h>
#include <stdlib.h>
#include "crates/parcel-plugin-abi/plugin.h"

// The single definition of the table declared by plugin.h. The wrappers it
// declares — parcel_asset_get_content() and friends — call through this.
const struct ParcelApi *parcel_api = 0;

InitStatus parcel_plugin_init(const struct ParcelApi *api, const uint8_t *config,
                              uintptr_t config_len, void **state,
                              Diagnostic *diagnostic) {
  if (!parcel_api_compatible(&api->header)) {
    return PARCEL_INIT_INCOMPATIBLE;
  }
  parcel_api = api;

  // This plugin keeps no state, so *state is left as Parcel initialized it.
  return PARCEL_INIT_OK;
}

void parcel_plugin_transform(Asset asset, Options options, void *state, Diagnostic *diagnostic) {
  Buffer buf = {0};
  parcel_asset_get_content(&buf, asset);

  const char *prefix = "export default '";
  const char *suffix = "';";
  size_t prefix_len = strlen(prefix);
  size_t suffix_len = strlen(suffix);
  size_t total_len = prefix_len + buf.len + suffix_len;

  char *res = malloc(total_len);
  if (!res) {
    parcel_free_buffer(&buf);
    return;
  }

  memcpy(res,                   prefix, prefix_len);
  memcpy(res + prefix_len,      buf.data, buf.len);
  memcpy(res + prefix_len + buf.len, suffix, suffix_len);

  parcel_asset_set_type(asset, (uint8_t *)"js", 2);
  parcel_asset_set_content(asset, (const uint8_t *)res, (uint32_t)total_len);

  parcel_free_buffer(&buf);
  free(res);
}
