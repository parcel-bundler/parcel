/// Exports `type` as this library's Parcel plugin.
///
/// Write it once, at file scope:
///
/// ```swift
/// #parcelPlugin(MyPlugin.self)
/// ```
///
/// It expands to the C entry points Parcel loads (`parcel_plugin_init`,
/// `parcel_plugin_transform`, and so on), each a one-line call into
/// ``PluginExports``.
@freestanding(
  declaration, names: named(__parcel_plugin_init), named(__parcel_plugin_deinit),
  named(__parcel_plugin_transform), named(__parcel_plugin_resolve), named(__parcel_plugin_name),
  named(__parcel_plugin_optimize), named(__parcel_plugin_report))
public macro parcelPlugin<P: Plugin>(_ type: P.Type) =
  #externalMacro(module: "ParcelPluginMacros", type: "ParcelPluginMacro")
