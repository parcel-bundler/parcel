use std::num::NonZeroU32;

#[derive(PartialEq, Eq, Hash, Clone, Copy, Debug)]
pub struct EnvironmentId(pub NonZeroU32);
