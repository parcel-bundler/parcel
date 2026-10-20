// swift-tools-version: 6.2

// The Swift plugin SDK, which lives in plugin-swift/. See plugin-swift/README.md.
//
// This manifest exists only so plugins can depend on the SDK by URL: SwiftPM
// only accepts a package at the root of a repository. It must declare the same
// targets as plugin-swift/Package.swift, which is the one to use when working on
// the SDK itself, and which plugin-swift/Examples depends on by path.

import CompilerPluginSupport
import PackageDescription

let package = Package(
  name: "ParcelPlugin",
  platforms: [.macOS(.v15)],
  products: [
    .library(name: "ParcelPlugin", targets: ["ParcelPlugin"])
  ],
  dependencies: [
    .package(url: "https://github.com/swiftlang/swift-syntax.git", "602.0.0"..<"605.0.0")
  ],
  targets: [
    .target(name: "CParcelABI", path: "plugin-swift/Sources/CParcelABI"),
    .macro(
      name: "ParcelPluginMacros",
      dependencies: [
        .product(name: "SwiftSyntaxMacros", package: "swift-syntax"),
        .product(name: "SwiftCompilerPlugin", package: "swift-syntax"),
      ],
      path: "plugin-swift/Sources/ParcelPluginMacros"
    ),
    .target(
      name: "ParcelPlugin",
      dependencies: ["CParcelABI", "ParcelPluginMacros"],
      path: "plugin-swift/Sources/ParcelPlugin"
    ),
  ]
)
