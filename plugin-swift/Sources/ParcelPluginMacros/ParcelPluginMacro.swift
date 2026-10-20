import SwiftCompilerPlugin
import SwiftDiagnostics
import SwiftSyntax
import SwiftSyntaxMacros

/// Expands `#parcelPlugin(MyPlugin.self)` to the C entry points Parcel loads,
/// each forwarding to `PluginExports<MyPlugin>`.
///
/// The expansion is deliberately trivial, so a plugin that would rather not
/// depend on swift-syntax can write it out by hand.
public struct ParcelPluginMacro: DeclarationMacro {
  public static func expansion(
    of node: some FreestandingMacroExpansionSyntax,
    in context: some MacroExpansionContext
  ) throws -> [DeclSyntax] {
    guard let argument = node.arguments.first?.expression,
      let member = argument.as(MemberAccessExprSyntax.self),
      member.declName.baseName.text == "self",
      let base = member.base
    else {
      context.diagnose(
        Diagnostic(node: Syntax(node), message: Message.expectedMetatype))
      return []
    }

    let exports = "ParcelPlugin.PluginExports<\(base.trimmedDescription)>"
    return [
      """
      @_cdecl("parcel_plugin_init")
      public func __parcel_plugin_init(
        _ api: UnsafeRawPointer?,
        _ config: UnsafePointer<UInt8>?,
        _ configLength: Int,
        _ state: UnsafeMutablePointer<UnsafeMutableRawPointer?>?,
        _ diagnostic: UnsafeMutableRawPointer?
      ) -> UInt8 {
        \(raw: exports).initialize(api, config, configLength, state, diagnostic)
      }
      """,
      """
      @_cdecl("parcel_plugin_deinit")
      public func __parcel_plugin_deinit(_ state: UnsafeMutableRawPointer?) {
        \(raw: exports).deinitialize(state)
      }
      """,
      """
      @_cdecl("parcel_plugin_transform")
      public func __parcel_plugin_transform(
        _ asset: UInt64,
        _ options: UInt64,
        _ state: UnsafeMutableRawPointer?,
        _ diagnostic: UnsafeMutableRawPointer?
      ) {
        \(raw: exports).transform(asset, options, state, diagnostic)
      }
      """,
      """
      @_cdecl("parcel_plugin_resolve")
      public func __parcel_plugin_resolve(
        _ dependency: UInt64,
        _ specifier: UnsafePointer<UInt8>?,
        _ specifierLength: Int,
        _ pipeline: UnsafePointer<UInt8>?,
        _ pipelineLength: Int,
        _ options: UInt64,
        _ result: UnsafeMutableRawPointer?,
        _ state: UnsafeMutableRawPointer?,
        _ diagnostic: UnsafeMutableRawPointer?
      ) {
        \(raw: exports).resolve(
          dependency, specifier, specifierLength, pipeline, pipelineLength, options, result, state,
          diagnostic)
      }
      """,
      """
      @_cdecl("parcel_plugin_name")
      public func __parcel_plugin_name(
        _ bundleGraph: UInt64,
        _ bundle: UInt64,
        _ options: UInt64,
        _ result: UnsafeMutableRawPointer?,
        _ state: UnsafeMutableRawPointer?,
        _ diagnostic: UnsafeMutableRawPointer?
      ) {
        \(raw: exports).name(bundleGraph, bundle, options, result, state, diagnostic)
      }
      """,
      """
      @_cdecl("parcel_plugin_optimize")
      public func __parcel_plugin_optimize(
        _ bundleGraph: UInt64,
        _ bundle: UInt64,
        _ contents: UnsafePointer<UInt8>?,
        _ contentsLength: Int,
        _ sourceMap: UnsafePointer<UInt8>?,
        _ sourceMapLength: Int,
        _ options: UInt64,
        _ result: UnsafeMutableRawPointer?,
        _ state: UnsafeMutableRawPointer?,
        _ diagnostic: UnsafeMutableRawPointer?
      ) {
        \(raw: exports).optimize(
          bundleGraph, bundle, contents, contentsLength, sourceMap, sourceMapLength, options, result,
          state, diagnostic)
      }
      """,
      """
      @_cdecl("parcel_plugin_report")
      public func __parcel_plugin_report(
        _ event: UnsafeRawPointer?,
        _ options: UInt64,
        _ state: UnsafeMutableRawPointer?,
        _ diagnostic: UnsafeMutableRawPointer?
      ) {
        \(raw: exports).report(event, options, state, diagnostic)
      }
      """,
    ]
  }

  enum Message: String, DiagnosticMessage {
    case expectedMetatype

    var message: String {
      switch self {
      case .expectedMetatype:
        "#parcelPlugin expects a plugin type, e.g. #parcelPlugin(MyPlugin.self)"
      }
    }

    var diagnosticID: MessageID { MessageID(domain: "ParcelPluginMacros", id: rawValue) }
    var severity: DiagnosticSeverity { .error }
  }
}

@main
struct ParcelPluginMacros: CompilerPlugin {
  let providingMacros: [any Macro.Type] = [ParcelPluginMacro.self]
}
