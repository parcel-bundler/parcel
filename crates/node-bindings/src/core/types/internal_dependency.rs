use napi_derive::napi;

#[napi(constructor)]
#[derive(Debug)]
pub struct InternalDependency {
  pub id: String,
}

#[napi]
impl InternalDependency {
  #[napi]
  pub fn default() -> Self {
    Self {
      id: Default::default(),
    }
  }
}
