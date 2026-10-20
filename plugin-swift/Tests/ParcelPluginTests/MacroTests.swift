import ParcelPluginMacros
import SwiftSyntaxMacroExpansion
import SwiftSyntaxMacros
import SwiftSyntaxMacrosTestSupport
import XCTest

final class MacroTests: XCTestCase {
  let macros: [String: any Macro.Type] = ["parcelPlugin": ParcelPluginMacro.self]

  func testExpandsToTheEntryPoints() throws {
    let expanded = try XCTUnwrap(
      ParcelPluginMacro.expansion(
        of: "#parcelPlugin(MyPlugin.self)" as ExprSyntax,
        in: BasicMacroExpansionContext()
      ).map(\.description).joined(separator: "\n"))
    for symbol in [
      "init", "deinit", "transform", "resolve", "name", "optimize", "report",
    ] {
      XCTAssertTrue(
        expanded.contains("@_cdecl(\"parcel_plugin_\(symbol)\")"), "missing parcel_plugin_\(symbol)")
    }
    XCTAssertTrue(expanded.contains("ParcelPlugin.PluginExports<MyPlugin>.initialize("))
  }

  func testRejectsAnythingButAMetatype() {
    assertMacroExpansion(
      "#parcelPlugin(MyPlugin())",
      expandedSource: "",
      diagnostics: [
        DiagnosticSpec(
          message: "#parcelPlugin expects a plugin type, e.g. #parcelPlugin(MyPlugin.self)",
          line: 1, column: 1)
      ],
      macros: macros
    )
  }
}

extension ParcelPluginMacro {
  fileprivate static func expansion(
    of expression: ExprSyntax, in context: some MacroExpansionContext
  ) throws -> [DeclSyntax] {
    let node = try XCTUnwrap(expression.as(MacroExpansionExprSyntax.self))
    return try expansion(of: node, in: context)
  }
}

import SwiftSyntax
