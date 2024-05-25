/// Analyzes assets to ensure they are in a valid state
///
/// Validators may throw errors or log warnings to indicate an asset is invalid. They can be used
/// to verify linting, type safety, etc and are run after a build has completed. This enables more
/// important compilation errors to occur first.
///
/// When Parcel runs in watch mode, the built bundles are served even if a validator throws an
/// error. But when running a build, Parcel exits with a failure and status code to ensure code is
/// not deployed for assets that do not meet the validation criteria. This ensures developers
/// remain productive, and do not have to worry about every small typing or linting issue while
/// trying to solve a problem.
///
pub trait ValidatorPlugin {}
