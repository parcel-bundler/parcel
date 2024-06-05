use std::collections::HashMap;
use std::collections::HashSet;

use super::cache::Cache;
use super::*;

fn root() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join("test")
}

fn test_resolver<'a>() -> Resolver<'a> {
  Resolver::parcel(
    root().into(),
    CacheCow::Owned(Cache::new(Arc::new(OsFileSystem))),
  )
}

fn node_resolver<'a>() -> Resolver<'a> {
  Resolver::node(
    root().into(),
    CacheCow::Owned(Cache::new(Arc::new(OsFileSystem))),
  )
}

#[test]
fn relative() {
  assert_eq!(
    test_resolver()
      .resolve("./bar.js", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(".///bar.js", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("./bar", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("~/bar", &root().join("nested/test.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("~bar", &root().join("nested/test.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "~/bar",
        &root().join("node_modules/foo/nested/baz.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("./nested", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("nested/index.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("./bar?foo=2", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("./bar?foo=2", &root().join("foo.js"), SpecifierType::Cjs)
      .result
      .unwrap_err(),
    ResolverError::FileNotFound {
      relative: "bar?foo=2".into(),
      from: root().join("foo.js")
    },
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./foo",
        &root().join("priority/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("priority/foo.js"))
  );

  let invalidations = test_resolver()
    .resolve("./bar", &root().join("foo.js"), SpecifierType::Esm)
    .invalidations;
  assert_eq!(
    invalidations
      .invalidate_on_file_create
      .into_iter()
      .collect::<HashSet<_>>(),
    HashSet::new()
  );
  assert_eq!(
    invalidations
      .invalidate_on_file_change
      .into_iter()
      .collect::<HashSet<_>>(),
    HashSet::from([root().join("package.json"), root().join("tsconfig.json")])
  );
}

#[test]
fn test_absolute() {
  assert_eq!(
    test_resolver()
      .resolve("/bar", &root().join("nested/test.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "/bar",
        &root().join("node_modules/foo/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );

  #[cfg(not(windows))]
  {
    assert_eq!(
      test_resolver()
        .resolve(
          "file:///bar",
          &root().join("nested/test.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("bar.js"))
    );
    assert_eq!(
      node_resolver()
        .resolve(
          root().join("foo.js").to_str().unwrap(),
          &root().join("nested/test.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("foo.js"))
    );
    assert_eq!(
      node_resolver()
        .resolve(
          &format!("file://{}", root().join("foo.js").to_str().unwrap()),
          &root().join("nested/test.js"),
          SpecifierType::Esm
        )
        .result
        .unwrap()
        .0,
      Resolution::Path(root().join("foo.js"))
    );
  }
}

#[test]
fn node_modules() {
  assert_eq!(
    test_resolver()
      .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/index.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("package-main", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-main/main.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("package-module", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-module/module.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-browser",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-browser/browser.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-fallback",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-fallback/index.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-main-directory",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-main-directory/nested/index.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("foo/nested/baz", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/nested/baz.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/@scope/pkg/index.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "@scope/pkg/foo/bar",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/@scope/pkg/foo/bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "foo/with space.mjs",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/with space.mjs"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "foo/with%20space.mjs",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/with space.mjs"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "foo/with space.mjs",
        &root().join("foo.js"),
        SpecifierType::Cjs
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/with space.mjs"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "foo/with%20space.mjs",
        &root().join("foo.js"),
        SpecifierType::Cjs
      )
      .result
      .unwrap_err(),
    ResolverError::ModuleSubpathNotFound {
      module: "foo".into(),
      path: root().join("node_modules/foo/with%20space.mjs"),
      package_path: root().join("node_modules/foo/package.json")
    },
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "@scope/pkg?foo=2",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/@scope/pkg/index.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "@scope/pkg?foo=2",
        &root().join("foo.js"),
        SpecifierType::Cjs
      )
      .result
      .unwrap_err(),
    ResolverError::ModuleNotFound {
      module: "@scope/pkg?foo=2".into()
    },
  );

  let invalidations = test_resolver()
    .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
    .invalidations;
  assert_eq!(
    invalidations
      .invalidate_on_file_create
      .into_iter()
      .collect::<HashSet<_>>(),
    HashSet::from([FileCreateInvalidation::FileName {
      file_name: "node_modules/foo".into(),
      above: root()
    },])
  );
  assert_eq!(
    invalidations
      .invalidate_on_file_change
      .into_iter()
      .collect::<HashSet<_>>(),
    HashSet::from([
      root().join("node_modules/foo/package.json"),
      root().join("package.json"),
      root().join("tsconfig.json")
    ])
  );
}

#[test]
fn browser_field() {
  assert_eq!(
    test_resolver()
      .resolve(
        "package-browser-alias",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-browser-alias/browser.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-browser-alias/foo",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-browser-alias/bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./foo",
        &root().join("node_modules/package-browser-alias/browser.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-browser-alias/bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./nested",
        &root().join("node_modules/package-browser-alias/browser.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(
      root().join("node_modules/package-browser-alias/subfolder1/subfolder2/subfile.js")
    )
  );
}

#[test]
fn local_aliases() {
  assert_eq!(
    test_resolver()
      .resolve(
        "package-alias/foo",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-alias/bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./foo",
        &root().join("node_modules/package-alias/browser.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-alias/bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./lib/test",
        &root().join("node_modules/package-alias-glob/browser.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-alias-glob/src/test.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-browser-exclude",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Empty
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./lib/test",
        &root().join("node_modules/package-alias-glob/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-alias-glob/src/test.js"))
  );

  let invalidations = test_resolver()
    .resolve(
      "package-alias/foo",
      &root().join("foo.js"),
      SpecifierType::Esm,
    )
    .invalidations;
  assert_eq!(
    invalidations
      .invalidate_on_file_create
      .into_iter()
      .collect::<HashSet<_>>(),
    HashSet::from([FileCreateInvalidation::FileName {
      file_name: "node_modules/package-alias".into(),
      above: root()
    },])
  );
  assert_eq!(
    invalidations
      .invalidate_on_file_change
      .into_iter()
      .collect::<HashSet<_>>(),
    HashSet::from([
      root().join("node_modules/package-alias/package.json"),
      root().join("package.json"),
      root().join("tsconfig.json")
    ])
  );
}

#[test]
fn global_aliases() {
  assert_eq!(
    test_resolver()
      .resolve("aliased", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/index.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "aliased",
        &root().join("node_modules/package-alias/foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/index.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "aliased/bar",
        &root().join("node_modules/package-alias/foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("aliased-file", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "aliased-file",
        &root().join("node_modules/package-alias/foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "aliasedfolder/test.js",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("nested/test.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("aliasedfolder", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("nested/index.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "aliasedabsolute/test.js",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("nested/test.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "aliasedabsolute",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("nested/index.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("foo/bar", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("glob/bar/test", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("nested/test.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("something", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("nested/test.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "something",
        &root().join("node_modules/package-alias/foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("nested/test.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-alias-exclude",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Empty
  );
  assert_eq!(
    test_resolver()
      .resolve("./baz", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("../baz", &root().join("x/foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("~/baz", &root().join("x/foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./baz",
        &root().join("node_modules/foo/bar.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/baz.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "~/baz",
        &root().join("node_modules/foo/bar.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/baz.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "/baz",
        &root().join("node_modules/foo/bar.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("url", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Empty
  );
}

#[test]
fn test_urls() {
  assert_eq!(
    test_resolver()
      .resolve(
        "http://example.com/foo.png",
        &root().join("foo.js"),
        SpecifierType::Url
      )
      .result
      .unwrap()
      .0,
    Resolution::External
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "//example.com/foo.png",
        &root().join("foo.js"),
        SpecifierType::Url
      )
      .result
      .unwrap()
      .0,
    Resolution::External
  );
  assert_eq!(
    test_resolver()
      .resolve("#hash", &root().join("foo.js"), SpecifierType::Url)
      .result
      .unwrap()
      .0,
    Resolution::External
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "http://example.com/foo.png",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap_err(),
    ResolverError::UnknownScheme {
      scheme: "http".into()
    },
  );
  assert_eq!(
    test_resolver()
      .resolve("bar.js", &root().join("foo.js"), SpecifierType::Url)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  // Reproduce bug for now
  // assert_eq!(
  //   test_resolver()
  //     .resolve("bar", &root().join("foo.js"), SpecifierType::Url)
  //     .result
  //     .unwrap_err(),
  //   ResolverError::FileNotFound {
  //     relative: "bar".into(),
  //     from: root().join("foo.js")
  //   }
  // );
  assert_eq!(
    test_resolver()
      .resolve("bar", &root().join("foo.js"), SpecifierType::Url)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("bar.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("npm:foo", &root().join("foo.js"), SpecifierType::Url)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/index.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve("npm:@scope/pkg", &root().join("foo.js"), SpecifierType::Url)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/@scope/pkg/index.js"))
  );
}

#[test]
fn test_exports() {
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-exports/main.mjs"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports/foo",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    // "browser" field is NOT used.
    Resolution::Path(root().join("node_modules/package-exports/foo.mjs"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports/features/test",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-exports/features/test.mjs"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports/extensionless-features/test",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-exports/features/test.mjs"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports/extensionless-features/test.mjs",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-exports/features/test.mjs"))
  );
  assert_eq!(
    node_resolver()
      .resolve(
        "package-exports/extensionless-features/test",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap_err(),
    ResolverError::ModuleSubpathNotFound {
      module: "package-exports".into(),
      package_path: root().join("node_modules/package-exports/package.json"),
      path: root().join("node_modules/package-exports/features/test"),
    },
  );
  assert_eq!(
    node_resolver()
      .resolve(
        "package-exports/extensionless-features/test",
        &root().join("foo.js"),
        SpecifierType::Cjs
      )
      .result
      .unwrap_err(),
    ResolverError::ModuleSubpathNotFound {
      module: "package-exports".into(),
      package_path: root().join("node_modules/package-exports/package.json"),
      path: root().join("node_modules/package-exports/features/test"),
    },
  );
  assert_eq!(
    node_resolver()
      .resolve(
        "package-exports/extensionless-features/test.mjs",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-exports/features/test.mjs"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports/space",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-exports/with space.mjs"))
  );
  // assert_eq!(
  //   test_resolver().resolve("package-exports/with%20space", &root().join("foo.js"), SpecifierType::Esm).unwrap().0,
  //   Resolution::Path(root().join("node_modules/package-exports/with space.mjs"))
  // );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports/with space",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap_err(),
    ResolverError::PackageJsonError {
      module: "package-exports".into(),
      path: root().join("node_modules/package-exports/package.json"),
      error: PackageJsonError::PackagePathNotExported
    },
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports/internal",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap_err(),
    ResolverError::PackageJsonError {
      module: "package-exports".into(),
      path: root().join("node_modules/package-exports/package.json"),
      error: PackageJsonError::PackagePathNotExported
    },
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports/internal.mjs",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap_err(),
    ResolverError::PackageJsonError {
      module: "package-exports".into(),
      path: root().join("node_modules/package-exports/package.json"),
      error: PackageJsonError::PackagePathNotExported
    },
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports/invalid",
        &root().join("foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap_err(),
    ResolverError::PackageJsonError {
      module: "package-exports".into(),
      path: root().join("node_modules/package-exports/package.json"),
      error: PackageJsonError::InvalidPackageTarget
    }
  );
}

#[test]
fn test_self_reference() {
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports",
        &root().join("node_modules/package-exports/foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-exports/main.mjs"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "package-exports/foo",
        &root().join("node_modules/package-exports/foo.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-exports/foo.mjs"))
  );
}

#[test]
fn test_imports() {
  assert_eq!(
    test_resolver()
      .resolve(
        "#internal",
        &root().join("node_modules/package-exports/main.mjs"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/package-exports/internal.mjs"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "#foo",
        &root().join("node_modules/package-exports/main.mjs"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/index.js"))
  );
}

#[test]
fn test_builtins() {
  assert_eq!(
    test_resolver()
      .resolve("zlib", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Builtin("zlib".into())
  );
  assert_eq!(
    test_resolver()
      .resolve("node:zlib", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Builtin("zlib".into())
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "node:fs/promises",
        &root().join("foo.js"),
        SpecifierType::Cjs
      )
      .result
      .unwrap()
      .0,
    Resolution::Builtin("fs/promises".into())
  );
}

#[test]
fn test_tsconfig() {
  assert_eq!(
    test_resolver()
      .resolve("ts-path", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("foo.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "ts-path",
        &root().join("nested/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("nested/test.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "foo",
        &root().join("tsconfig/index/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/tsconfig-index/foo.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "foo",
        &root().join("tsconfig/field/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/tsconfig-field/foo.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "foo",
        &root().join("tsconfig/exports/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/tsconfig-exports/foo.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "foo",
        &root().join("tsconfig/extends-extension/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("tsconfig/extends-extension/foo.js"))
  );

  let mut extends_node_module_resolver = test_resolver();
  extends_node_module_resolver.include_node_modules = Cow::Owned(IncludeNodeModules::Bool(false));
  assert_eq!(
    extends_node_module_resolver
      .resolve(
        "./bar",
        &root().join("tsconfig/extends-node-module/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("tsconfig/extends-node-module/bar.ts"))
  );

  assert_eq!(
    test_resolver()
      .resolve(
        "ts-path",
        &root().join("node_modules/tsconfig-not-used/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap_err(),
    ResolverError::ModuleNotFound {
      module: "ts-path".into()
    },
  );
  assert_eq!(
    test_resolver()
      .resolve("ts-path", &root().join("foo.css"), SpecifierType::Esm)
      .result
      .unwrap_err(),
    ResolverError::ModuleNotFound {
      module: "ts-path".into()
    },
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "zlib",
        &root().join("tsconfig/builtins/thing.js"),
        SpecifierType::Cjs
      )
      .result
      .unwrap()
      .0,
    Resolution::Builtin("zlib".into())
  );

  let invalidations = test_resolver()
    .resolve("ts-path", &root().join("foo.js"), SpecifierType::Esm)
    .invalidations;
  assert_eq!(
    invalidations
      .invalidate_on_file_create
      .into_iter()
      .collect::<HashSet<_>>(),
    HashSet::new()
  );
  assert_eq!(
    invalidations
      .invalidate_on_file_change
      .into_iter()
      .collect::<HashSet<_>>(),
    HashSet::from([root().join("package.json"), root().join("tsconfig.json")])
  );
}

#[test]
fn test_module_suffixes() {
  assert_eq!(
    test_resolver()
      .resolve(
        "./a",
        &root().join("tsconfig/suffixes/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("tsconfig/suffixes/a.ios.ts"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./a.ts",
        &root().join("tsconfig/suffixes/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("tsconfig/suffixes/a.ios.ts"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./b",
        &root().join("tsconfig/suffixes/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("tsconfig/suffixes/b.ts"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./b.ts",
        &root().join("tsconfig/suffixes/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("tsconfig/suffixes/b.ts"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./c",
        &root().join("tsconfig/suffixes/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("tsconfig/suffixes/c-test.ts"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./c.ts",
        &root().join("tsconfig/suffixes/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("tsconfig/suffixes/c-test.ts"))
  );
}

#[test]
fn test_tsconfig_parsing() {
  assert_eq!(
    test_resolver()
      .resolve(
        "foo",
        &root().join("tsconfig/trailing-comma/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("tsconfig/trailing-comma/bar.js"))
  );
}

#[test]
fn test_ts_extensions() {
  assert_eq!(
    test_resolver()
      .resolve(
        "./a.js",
        &root().join("ts-extensions/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("ts-extensions/a.ts"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./a.jsx",
        &root().join("ts-extensions/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    // TSC always prioritizes .ts over .tsx
    Resolution::Path(root().join("ts-extensions/a.ts"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./a.mjs",
        &root().join("ts-extensions/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("ts-extensions/a.mts"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./a.cjs",
        &root().join("ts-extensions/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("ts-extensions/a.cts"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./b.js",
        &root().join("ts-extensions/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    // We deviate from TSC here to match Node/bundlers.
    Resolution::Path(root().join("ts-extensions/b.js"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./c.js",
        &root().join("ts-extensions/index.ts"),
        SpecifierType::Esm
      )
      .result
      .unwrap()
      .0,
    // This matches TSC. c.js.ts seems kinda unlikely?
    Resolution::Path(root().join("ts-extensions/c.ts"))
  );
  assert_eq!(
    test_resolver()
      .resolve(
        "./a.js",
        &root().join("ts-extensions/index.js"),
        SpecifierType::Esm
      )
      .result
      .unwrap_err(),
    ResolverError::FileNotFound {
      relative: "a.js".into(),
      from: root().join("ts-extensions/index.js")
    },
  );

  let invalidations = test_resolver()
    .resolve(
      "./a.js",
      &root().join("ts-extensions/index.ts"),
      SpecifierType::Esm,
    )
    .invalidations;
  assert_eq!(
    invalidations
      .invalidate_on_file_create
      .into_iter()
      .collect::<HashSet<_>>(),
    HashSet::from([
      FileCreateInvalidation::Path(root().join("ts-extensions/a.js")),
      FileCreateInvalidation::FileName {
        file_name: "package.json".into(),
        above: root().join("ts-extensions")
      },
      FileCreateInvalidation::FileName {
        file_name: "tsconfig.json".into(),
        above: root().join("ts-extensions")
      },
    ])
  );
  assert_eq!(
    invalidations
      .invalidate_on_file_change
      .into_iter()
      .collect::<HashSet<_>>(),
    HashSet::from([root().join("package.json"), root().join("tsconfig.json")])
  );
}

fn resolve_side_effects(specifier: &str, from: &Path) -> bool {
  let resolver = test_resolver();
  let resolved = resolver
    .resolve(specifier, from, SpecifierType::Esm)
    .result
    .unwrap()
    .0;

  if let Resolution::Path(path) = resolved {
    resolver
      .resolve_side_effects(&path, &Invalidations::default())
      .unwrap()
  } else {
    unreachable!()
  }
}

#[test]
fn test_side_effects() {
  assert!(!resolve_side_effects(
    "side-effects-false/src/index.js",
    &root().join("foo.js")
  ));
  assert!(!resolve_side_effects(
    "side-effects-false/src/index",
    &root().join("foo.js")
  ));
  assert!(!resolve_side_effects(
    "side-effects-false/src/",
    &root().join("foo.js")
  ));
  assert!(!resolve_side_effects(
    "side-effects-false",
    &root().join("foo.js")
  ));
  assert!(!resolve_side_effects(
    "side-effects-package-redirect-up/foo/bar",
    &root().join("foo.js")
  ));
  assert!(!resolve_side_effects(
    "side-effects-package-redirect-down/foo/bar",
    &root().join("foo.js")
  ));
  assert!(resolve_side_effects(
    "side-effects-false-glob/a/index",
    &root().join("foo.js")
  ));
  assert!(!resolve_side_effects(
    "side-effects-false-glob/b/index.js",
    &root().join("foo.js")
  ));
  assert!(!resolve_side_effects(
    "side-effects-false-glob/sub/a/index.js",
    &root().join("foo.js")
  ));
  assert!(resolve_side_effects(
    "side-effects-false-glob/sub/index.json",
    &root().join("foo.js")
  ));
}

#[test]
fn test_include_node_modules() {
  let mut resolver = test_resolver();
  resolver.include_node_modules = Cow::Owned(IncludeNodeModules::Bool(false));

  assert_eq!(
    resolver
      .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::External
  );
  assert_eq!(
    resolver
      .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::External
  );

  resolver.include_node_modules = Cow::Owned(IncludeNodeModules::Array(vec!["foo".into()]));
  assert_eq!(
    resolver
      .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/foo/index.js"))
  );
  assert_eq!(
    resolver
      .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::External
  );

  resolver.include_node_modules = Cow::Owned(IncludeNodeModules::Map(HashMap::from([
    ("foo".into(), false),
    ("@scope/pkg".into(), true),
  ])));
  assert_eq!(
    resolver
      .resolve("foo", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::External
  );
  assert_eq!(
    resolver
      .resolve("@scope/pkg", &root().join("foo.js"), SpecifierType::Esm)
      .result
      .unwrap()
      .0,
    Resolution::Path(root().join("node_modules/@scope/pkg/index.js"))
  );
}

// #[test]
// fn test_visitor() {
//   let resolved = test_resolver().resolve("unified", &root(), SpecifierType::Esm).unwrap();
//   println!("{:?}", resolved);
//   if let Resolution::Path(p) = resolved {
//     let res = build_esm_graph(
//       &p,
//       root()
//     ).unwrap();
//     println!("{:?}", res);
//   }
// }
