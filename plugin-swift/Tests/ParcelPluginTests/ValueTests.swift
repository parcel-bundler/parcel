import CParcelABI
import Testing

@testable import ParcelPlugin

/// The SDK's own copies of plugin.h's constants must match it.
@Suite struct ConstantsTests {
  @Test func enumerations() {
    #expect(SpecifierType.esm.rawValue == PARCEL_SPECIFIER_ESM.rawValue)
    #expect(SpecifierType.commonJS.rawValue == PARCEL_SPECIFIER_COMMONJS.rawValue)
    #expect(SpecifierType.url.rawValue == PARCEL_SPECIFIER_URL.rawValue)
    #expect(SpecifierType.custom.rawValue == PARCEL_SPECIFIER_CUSTOM.rawValue)

    #expect(Priority.sync.rawValue == PARCEL_PRIORITY_SYNC.rawValue)
    #expect(Priority.parallel.rawValue == PARCEL_PRIORITY_PARALLEL.rawValue)
    #expect(Priority.lazy.rawValue == PARCEL_PRIORITY_LAZY.rawValue)

    #expect(ImportType.javaScript.rawValue == PARCEL_IMPORT_TYPE_JAVASCRIPT.rawValue)
    #expect(ImportType.styleSheet.rawValue == PARCEL_IMPORT_TYPE_STYLESHEET.rawValue)
    #expect(ImportType.url.rawValue == PARCEL_IMPORT_TYPE_URL.rawValue)
    #expect(ImportType.text.rawValue == PARCEL_IMPORT_TYPE_TEXT.rawValue)
    #expect(ImportType.bytes.rawValue == PARCEL_IMPORT_TYPE_BYTES.rawValue)

    #expect(BundleBehavior.none.rawValue == PARCEL_BUNDLE_BEHAVIOR_NONE.rawValue)
    #expect(BundleBehavior.inline.rawValue == PARCEL_BUNDLE_BEHAVIOR_INLINE.rawValue)
    #expect(BundleBehavior.isolated.rawValue == PARCEL_BUNDLE_BEHAVIOR_ISOLATED.rawValue)

    #expect(Environment.browser.rawValue == PARCEL_ENV_BROWSER.rawValue)
    #expect(Environment.webWorker.rawValue == PARCEL_ENV_WEB_WORKER.rawValue)
    #expect(Environment.serviceWorker.rawValue == PARCEL_ENV_SERVICE_WORKER.rawValue)
    #expect(Environment.worklet.rawValue == PARCEL_ENV_WORKLET.rawValue)
    #expect(Environment.node.rawValue == PARCEL_ENV_NODE.rawValue)
    #expect(Environment.electronMain.rawValue == PARCEL_ENV_ELECTRON_MAIN.rawValue)
    #expect(Environment.electronRenderer.rawValue == PARCEL_ENV_ELECTRON_RENDERER.rawValue)
    #expect(Environment.reactClient.rawValue == PARCEL_ENV_REACT_CLIENT.rawValue)
    #expect(Environment.reactServer.rawValue == PARCEL_ENV_REACT_SERVER.rawValue)

    #expect(OutputFormat.global.rawValue == PARCEL_OUTPUT_FORMAT_GLOBAL.rawValue)
    #expect(OutputFormat.commonJS.rawValue == PARCEL_OUTPUT_FORMAT_COMMONJS.rawValue)
    #expect(OutputFormat.esModule.rawValue == PARCEL_OUTPUT_FORMAT_ESMODULE.rawValue)

    #expect(SourceType.module.rawValue == PARCEL_SOURCE_TYPE_MODULE.rawValue)
    #expect(SourceType.script.rawValue == PARCEL_SOURCE_TYPE_SCRIPT.rawValue)

    #expect(LogLevel.none.rawValue == PARCEL_LOG_NONE.rawValue)
    #expect(LogLevel.error.rawValue == PARCEL_LOG_ERROR.rawValue)
    #expect(LogLevel.warn.rawValue == PARCEL_LOG_WARN.rawValue)
    #expect(LogLevel.info.rawValue == PARCEL_LOG_INFO.rawValue)
    #expect(LogLevel.verbose.rawValue == PARCEL_LOG_VERBOSE.rawValue)

    #expect(Severity.error.rawValue == PARCEL_SEVERITY_ERROR.rawValue)
    #expect(Severity.warning.rawValue == PARCEL_SEVERITY_WARNING.rawValue)
    #expect(Severity.sourceError.rawValue == PARCEL_SEVERITY_SOURCE_ERROR.rawValue)
    #expect(Severity.info.rawValue == PARCEL_SEVERITY_INFO.rawValue)
  }

  @Test func flags() {
    #expect(AssetFlags.isSource.rawValue == PARCEL_ASSET_IS_SOURCE.rawValue)
    #expect(AssetFlags.sideEffects.rawValue == PARCEL_ASSET_SIDE_EFFECTS.rawValue)
    #expect(AssetFlags.isBundleSplittable.rawValue == PARCEL_ASSET_IS_BUNDLE_SPLITTABLE.rawValue)
    #expect(AssetFlags.largeBlob.rawValue == PARCEL_ASSET_LARGE_BLOB.rawValue)
    #expect(AssetFlags.hasCJSExports.rawValue == PARCEL_ASSET_HAS_CJS_EXPORTS.rawValue)
    #expect(AssetFlags.staticExports.rawValue == PARCEL_ASSET_STATIC_EXPORTS.rawValue)
    #expect(AssetFlags.shouldWrap.rawValue == PARCEL_ASSET_SHOULD_WRAP.rawValue)
    #expect(AssetFlags.isConstantModule.rawValue == PARCEL_ASSET_IS_CONSTANT_MODULE.rawValue)
    #expect(
      AssetFlags.hasNodeReplacements.rawValue == PARCEL_ASSET_HAS_NODE_REPLACEMENTS.rawValue)
    #expect(AssetFlags.hasSymbols.rawValue == PARCEL_ASSET_HAS_SYMBOLS.rawValue)
    #expect(AssetFlags.isHTMLAttribute.rawValue == PARCEL_ASSET_IS_HTML_ATTR.rawValue)
    #expect(AssetFlags.isHTMLTag.rawValue == PARCEL_ASSET_IS_HTML_TAG.rawValue)
    #expect(AssetFlags.isESM.rawValue == PARCEL_ASSET_IS_ESM.rawValue)

    #expect(DependencyFlags.entry.rawValue == PARCEL_DEP_ENTRY.rawValue)
    #expect(DependencyFlags.optional.rawValue == PARCEL_DEP_OPTIONAL.rawValue)
    #expect(DependencyFlags.needsStableName.rawValue == PARCEL_DEP_NEEDS_STABLE_NAME.rawValue)
    #expect(DependencyFlags.isWebWorker.rawValue == PARCEL_DEP_IS_WEBWORKER.rawValue)
    #expect(DependencyFlags.sideEffects.rawValue == PARCEL_DEP_SIDE_EFFECTS.rawValue)
    #expect(DependencyFlags.macro.rawValue == PARCEL_DEP_MACRO.rawValue)

    #expect(ExportsConditions.import.rawValue == PARCEL_EXPORTS_CONDITION_IMPORT.rawValue)
    #expect(ExportsConditions.require.rawValue == PARCEL_EXPORTS_CONDITION_REQUIRE.rawValue)
    #expect(ExportsConditions.module.rawValue == PARCEL_EXPORTS_CONDITION_MODULE.rawValue)
    #expect(ExportsConditions.node.rawValue == PARCEL_EXPORTS_CONDITION_NODE.rawValue)
    #expect(ExportsConditions.browser.rawValue == PARCEL_EXPORTS_CONDITION_BROWSER.rawValue)
    #expect(ExportsConditions.worker.rawValue == PARCEL_EXPORTS_CONDITION_WORKER.rawValue)
    #expect(ExportsConditions.worklet.rawValue == PARCEL_EXPORTS_CONDITION_WORKLET.rawValue)
    #expect(ExportsConditions.electron.rawValue == PARCEL_EXPORTS_CONDITION_ELECTRON.rawValue)
    #expect(
      ExportsConditions.development.rawValue == PARCEL_EXPORTS_CONDITION_DEVELOPMENT.rawValue)
    #expect(ExportsConditions.production.rawValue == PARCEL_EXPORTS_CONDITION_PRODUCTION.rawValue)
    #expect(ExportsConditions.types.rawValue == PARCEL_EXPORTS_CONDITION_TYPES.rawValue)
    #expect(ExportsConditions.default.rawValue == PARCEL_EXPORTS_CONDITION_DEFAULT.rawValue)
    #expect(ExportsConditions.style.rawValue == PARCEL_EXPORTS_CONDITION_STYLE.rawValue)
    #expect(ExportsConditions.sass.rawValue == PARCEL_EXPORTS_CONDITION_SASS.rawValue)
    #expect(ExportsConditions.less.rawValue == PARCEL_EXPORTS_CONDITION_LESS.rawValue)
    #expect(ExportsConditions.stylus.rawValue == PARCEL_EXPORTS_CONDITION_STYLUS.rawValue)
    #expect(
      ExportsConditions.reactServer.rawValue == PARCEL_EXPORTS_CONDITION_REACT_SERVER.rawValue)
    #expect(ExportsConditions.source.rawValue == PARCEL_EXPORTS_CONDITION_SOURCE.rawValue)

    #expect(EnvironmentFlags.isLibrary.rawValue == PARCEL_ENV_FLAG_IS_LIBRARY.rawValue)
    #expect(EnvironmentFlags.shouldOptimize.rawValue == PARCEL_ENV_FLAG_SHOULD_OPTIMIZE.rawValue)
    #expect(
      EnvironmentFlags.shouldScopeHoist.rawValue == PARCEL_ENV_FLAG_SHOULD_SCOPE_HOIST.rawValue)
    #expect(
      EnvironmentFlags.moduleTypeExtension.rawValue
        == PARCEL_ENV_FLAG_MODULE_TYPE_EXTENSION.rawValue)

    #expect(BundleFlags.needsStableName.rawValue == PARCEL_BUNDLE_FLAG_NEEDS_STABLE_NAME.rawValue)
    #expect(BundleFlags.isSplittable.rawValue == PARCEL_BUNDLE_FLAG_IS_SPLITTABLE.rawValue)
    #expect(BundleFlags.isPlaceholder.rawValue == PARCEL_BUNDLE_FLAG_IS_PLACEHOLDER.rawValue)
    #expect(BundleFlags.entry.rawValue == PARCEL_BUNDLE_FLAG_ENTRY.rawValue)

    #expect(FileKind.file.rawValue == PARCEL_FILE_KIND_FILE.rawValue)
    #expect(FileKind.directory.rawValue == PARCEL_FILE_KIND_DIR.rawValue)
    #expect(FileKind.symlink.rawValue == PARCEL_FILE_KIND_SYMLINK.rawValue)
  }

  /// Raw values the SDK writes or switches on without a Swift type.
  @Test func statuses() {
    #expect(PARCEL_INIT_OK.rawValue == 0)
    #expect(PARCEL_INIT_ERROR.rawValue == 1)
    #expect(PARCEL_INIT_INCOMPATIBLE.rawValue == 2)
    #expect(PARCEL_IO_OK.rawValue == 0)
    #expect(PARCEL_IO_NOT_FOUND.rawValue == 1)
    #expect(PARCEL_RESOLUTION_NONE.rawValue == 0)
    #expect(PARCEL_RESOLUTION_FILE_PATH.rawValue == 1)
    #expect(PARCEL_RESOLUTION_EXTERNAL.rawValue == 2)
    #expect(PARCEL_RESOLUTION_EXCLUDED.rawValue == 3)
    #expect(PARCEL_EVENT_BUILD_START.rawValue == 0)
    #expect(PARCEL_EVENT_BUILD_SUCCESS.rawValue == 1)
    #expect(PARCEL_EVENT_BUILD_FAILURE.rawValue == 2)
    #expect(PARCEL_EVENT_LOG.rawValue == 3)
    #expect(PARCEL_BUNDLE_GRAPH_RESOLUTION_NONE.rawValue == 1)
    #expect(PARCEL_BUNDLE_GRAPH_RESOLUTION_ASSET.rawValue == 5)
    #expect(PARCEL_BUNDLE_GRAPH_RESOLUTION_INTERNALIZED.rawValue == 7)
  }
}

@Suite struct ContentTypeIDTests {
  @Test func sha256() {
    let digest = SHA256.hash(Array("abc".utf8))
    #expect(
      digest.map {
        String($0, radix: 16).count == 1 ? "0\(String($0, radix: 16))" : String($0, radix: 16)
      }.joined()
        == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    // Crosses a block boundary.
    let long = SHA256.hash(Array(String(repeating: "a", count: 1000).utf8))
    #expect(long.prefix(4) == [0x41, 0xed, 0xec, 0xe4])
  }

  /// If this changes, every user's cache and bundle ids change with it.
  @Test func derivationIsStable() {
    let id = ContentTypeID("Example.UppercaseContent")
    #expect(ContentTypeID(bytes: id.bytes) == id)
    #expect(
      id.bytes
        == Array(
          SHA256.hash(Array("parcel.content.v1\0swift\0Example.UppercaseContent".utf8)).prefix(16)))
  }

  struct Content: AssetContent {
    func read() async throws -> ParcelPlugin.Content { .string("") }
    func package(
      _ bundle: OutputBundle, in bundleGraph: ParcelPlugin.BundleGraph,
      options: ParcelPlugin.Options
    ) async throws
      -> ParcelPlugin.Content
    { .string("") }
  }

  @Test func defaultIDIsTheQualifiedTypeName() {
    #expect(Content.contentTypeID == ContentTypeID("ParcelPluginTests.ContentTypeIDTests.Content"))
  }
}

@Suite struct DiagnosticTests {
  struct Config: Decodable {
    var prefix: String
    var nested: Nested
    struct Nested: Decodable { var count: Int }
  }

  @Test func decodingErrorsNameThePath() {
    #expect(throws: (any Error).self) {
      do {
        _ = try JSONDecoder().decode(
          Config.self, from: Data(#"{"prefix":"","nested":{"count":"x"}}"#.utf8))
      } catch {
        #expect(
          ParcelPlugin.Diagnostic(error).message.hasPrefix("Invalid plugin config at nested.count:")
        )
        throw error
      }
    }
  }

  @Test func otherErrorsUseTheirDescription() {
    struct Plain: Error, CustomStringConvertible { var description: String { "plain" } }
    struct Localized: LocalizedError { var errorDescription: String? { "localized" } }
    #expect(ParcelPlugin.Diagnostic(Plain()).message == "plain")
    #expect(ParcelPlugin.Diagnostic(Localized()).message == "localized")
    #expect(
      ParcelPlugin.Diagnostic(FileSystemError.notFound(path: "/x")).message
        == "/x: no such file or directory")
    let diagnostic = ParcelPlugin.Diagnostic.warning("careful", hint: "hint")
    #expect(ParcelPlugin.Diagnostic(diagnostic) == diagnostic)
  }
}

#if canImport(FoundationEssentials)
  import FoundationEssentials
#else
  import Foundation
#endif
