const std = @import("std");

extern fn parcel_asset_get_content(buffer: *Buffer, asset: u64) void;
extern fn parcel_asset_set_content(asset: u64, data: [*]const u8, len: u32) void;
extern fn parcel_asset_set_type(asset: u64, type_name: [*:0]const u8) void;
extern fn parcel_free_buffer(buffer: *const Buffer) void;

pub const Buffer = extern struct {
    data: [*]u8,
    len: usize,
    cap: usize,

    /// Converts the C buffer to a safe Zig slice
    pub fn asSlice(self: Buffer) []u8 {
        return self.data[0..self.len];
    }

    /// Explicitly release memory via the plugin API
    pub fn deinit(self: *const Buffer) void {
        parcel_free_buffer(self);
    }
};

pub const Asset = struct {
    handle: u64,

    pub fn getContent(self: Asset) Buffer {
        var buf: Buffer = undefined;
        parcel_asset_get_content(&buf, self.handle);
        return buf;
    }

    pub fn setContent(self: Asset, data: []const u8) void {
        parcel_asset_set_content(self.handle, data.ptr, @intCast(data.len));
    }

    pub fn setType(self: Asset, asset_type: [:0]const u8) void {
        parcel_asset_set_type(self.handle, asset_type.ptr);
    }
};

export fn parcel_plugin_transform(handle: u64) void {
    const asset = Asset{ .handle = handle };

    const buffer = asset.getContent();
    defer buffer.deinit();

    const prefix = "export default 'Hello from zig! ";
    const suffix = "';";
    const input = buffer.asSlice();

    const allocator = std.heap.c_allocator;
    const res = std.mem.concat(allocator, u8, &[_][]const u8{ prefix, input, suffix }) catch return;
    defer allocator.free(res);

    asset.setType("js");
    asset.setContent(res);
}
