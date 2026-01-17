#include <span>
#include <string_view>
#include <string>
#include <vector>
#include <stdexcept>
#include "plugin.h"

class ParcelBuffer {
  Buffer buffer;

public:
  ParcelBuffer() = default;
  ~ParcelBuffer() { parcel_free_buffer(&buffer); }

  ParcelBuffer(const ParcelBuffer&) = delete;
  ParcelBuffer& operator=(const ParcelBuffer&) = delete;

  ParcelBuffer(ParcelBuffer&& other) noexcept : buffer(other.buffer) {
    other.buffer = {};
  }

  std::span<uint8_t> data() { 
    return {buffer.data, buffer.len}; 
  }

  std::string_view as_string() const {
    return {reinterpret_cast<const char*>(buffer.data), buffer.len};
  }

  Buffer* ptr() { return &buffer; }
};

class ParcelAsset {
  Asset handle;

public:
  explicit ParcelAsset(Asset a) : handle(a) {}

  ParcelBuffer get_content() const {
    ParcelBuffer buf;
    parcel_asset_get_content(buf.ptr(), handle);
    return buf;
  }

  void set_content(std::span<const uint8_t> data) {
    parcel_asset_set_content(handle, reinterpret_cast<const uint8_t*>(data.data()), static_cast<uint32_t>(data.size()));
  }

  void set_content(std::string_view data) {
    parcel_asset_set_content(handle, reinterpret_cast<const uint8_t*>(data.data()), data.size());
  }

  void set_type(std::string_view type) {
    parcel_asset_set_type(handle, type.data());
  }
};

extern "C" __attribute__((visibility("default")))
void parcel_plugin_transform(Asset asset_handle) {
  ParcelAsset asset(asset_handle);
  ParcelBuffer buffer = asset.get_content();

  std::string res = "export default 'Hello from C++! ";
  res += buffer.as_string();
  res += "';";

  asset.set_type("js");
  asset.set_content(res);
}
