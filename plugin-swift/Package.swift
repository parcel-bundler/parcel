// swift-tools-version: 6.2

// The manifest for working on the SDK. Plugins that depend on it by URL get the
// copy at the root of the repository instead, since SwiftPM only accepts a
// package at the root of a repository: keep the two in sync.

import CompilerPluginSupport
import PackageDescription

let package = Package(
  name: "ParcelPlugin",
  // TaskExecutor (SE-0417), which the async bridge is built on, needs the macOS 15
  // Concurrency runtime.
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "ParcelPlugin", targets: ["ParcelPlugin"])
  ],
  dependencies: [
    .package(url: "https://github.com/swiftlang/swift-syntax.git", "602.0.0"..<"605.0.0")
  ],
  targets: [
    // plugin.h, copied here by crates/parcel-plugin-abi/build.rs.
    .target(name: "CParcelABI"),
    .macro(
      name: "ParcelPluginMacros",
      dependencies: [
        .product(name: "SwiftSyntaxMacros", package: "swift-syntax"),
        .product(name: "SwiftCompilerPlugin", package: "swift-syntax"),
      ]
    ),
    .target(
      name: "ParcelPlugin",
      dependencies: ["CParcelABI", "ParcelPluginMacros"]
    ),
    .testTarget(
      name: "ParcelPluginTests",
      dependencies: [
        "ParcelPlugin",
        "CParcelABI",
        "ParcelPluginMacros",
        .product(name: "SwiftSyntaxMacrosTestSupport", package: "swift-syntax"),
      ]
    ),
  ]
)
