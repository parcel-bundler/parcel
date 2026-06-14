#include <string.h>
#include <stdlib.h>
#include "crates/parcel-plugin-abi/plugin.h"

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
