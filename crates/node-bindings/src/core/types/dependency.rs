use napi_derive::napi;

#[napi(constructor)]
#[derive(Debug)]
pub struct Dependency {
  pub id: String,
  // specifier: DependencySpecifier,
  // specifierType: $Values<typeof SpecifierType>,
  // priority: $Values<typeof Priority>,
  // pub needs_stable_name: bool,
  // bundleBehavior: ?$Values<typeof BundleBehavior>,
  // pub is_entry: bool,
  // pub is_optional: bool,
  // loc: ?InternalSourceLocation,
  // env: Environment,
  // pub package_conditions: Option<i64>,
  // customPackageConditions?: Array<string>,
  // meta: Meta,
  // resolverMeta?: ?Meta,
  // target: ?Target,
  // sourceAssetId: ?string,
  // sourcePath: ?ProjectPath,
  // sourceAssetType?: ?string,
  // resolveFrom: ?ProjectPath,
  // range: ?SemverRange,
  // symbols: ?Map<
  //   Symbol,
  //   {|
  //     local: Symbol,
  //     loc: ?InternalSourceLocation,
  //     isWeak: boolean,
  //     meta?: ?Meta,
  //   |},
  // >,
  // pipeline?: ?string,
}

#[napi]
impl Dependency {
  #[napi]
  pub fn default() -> Self {
    Self {
      id: Default::default(),
    }
  }
}
