#include <string.h>
#include <stdlib.h>
#include "plugin.h"

__attribute__((visibility("default")))
extern void parcel_plugin_transform(Asset asset) {
  Buffer buffer;
  parcel_asset_get_content(&buffer, asset);

  const char *prefix = "export default '";
  const char *suffix = "';";
  size_t prefix_len = strlen(prefix);
  size_t suffix_len = strlen(suffix);

  // Calculate exact total length
  size_t total_len = prefix_len + buffer.len + suffix_len;

  char *res = malloc(total_len);
  if (!res) {
    parcel_free_buffer(&buffer);
    return;
  }

  char *current = res;
  memcpy(current, prefix, prefix_len);
  current += prefix_len;
  
  memcpy(current, buffer.data, buffer.len);
  current += buffer.len;
  
  memcpy(current, suffix, suffix_len);

  parcel_asset_set_type(asset, "js");
  parcel_asset_set_content(asset, (const uint8_t *)res, strlen(res));
  
  parcel_free_buffer(&buffer);
  free(res);
}
