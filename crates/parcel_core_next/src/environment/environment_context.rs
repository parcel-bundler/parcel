use serde_repr::Deserialize_repr;
use serde_repr::Serialize_repr;

#[derive(PartialEq, Clone, Copy, Debug, Hash, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum EnvironmentContext {
  Browser = 0,
  WebWorker = 1,
  ServiceWorker = 2,
  Worklet = 3,
  Node = 4,
  ElectronMain = 5,
  ElectronRenderer = 6,
}

impl EnvironmentContext {
  pub fn is_node(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, Node | ElectronMain | ElectronRenderer)
  }

  pub fn is_browser(&self) -> bool {
    use EnvironmentContext::*;
    matches!(
      self,
      Browser | WebWorker | ServiceWorker | Worklet | ElectronRenderer
    )
  }

  pub fn is_worker(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, WebWorker | ServiceWorker)
  }

  pub fn is_electron(&self) -> bool {
    use EnvironmentContext::*;
    matches!(self, ElectronMain | ElectronRenderer)
  }
}
