use std::borrow::Cow;
use std::path::PathBuf;

use parcel_filesystem::FileSystem;
use parcel_resolver::Cache;
use parcel_resolver::CacheCow;
use parcel_resolver::Resolver;
use parcel_resolver::SpecifierType;

use crate::core::requests::actor::Actor;

pub enum ResolverMessage {
  Resolve {
    specifier: String,
    from: PathBuf,
    specifier_type: SpecifierType,
  },
}

pub struct ResolverActor<'a, FS: FileSystem> {
  resolver: Resolver<'a, FS>,
}

impl<'a, FS: FileSystem> ResolverActor<'a, FS> {
  pub fn new(resolver: Resolver<'a, FS>) -> Self {
    Self { resolver }
  }
}

impl<'a, FS: FileSystem + Send + Sync> Actor for ResolverActor<'a, FS> {
  type Message = ResolverMessage;
  type Response = ();

  async fn handle(&mut self, message: Self::Message) -> anyhow::Result<Self::Response> {
    let ResolverMessage::Resolve {
      specifier,
      from,
      specifier_type,
    } = message;
    let resolve_result = self.resolver.resolve(&specifier, &from, specifier_type);
    match resolve_result.result {
      Ok(_) => {}
      Err(_) => {}
    }
    Ok(())
  }
}

#[cfg(test)]
mod test {
  use parcel_filesystem::in_memory_file_system::InMemoryFileSystem;

  use crate::core::requests::actor::spawn;

  use super::*;

  #[test]
  fn test_create_resolver() {
    let fs = InMemoryFileSystem::default();
    let project_root = Cow::Owned("/".into());
    let cache = CacheCow::Owned(Cache::new(fs));
    let resolver = Resolver::parcel(project_root, cache);
    let _actor = ResolverActor::new(resolver);
  }

  #[tokio::test]
  async fn test_spawn_resolver() {
    let fs = InMemoryFileSystem::default();
    let project_root = Cow::Owned("/".into());
    let cache = CacheCow::Owned(Cache::new(fs));
    let resolver = Resolver::parcel(project_root, cache);
    let actor = ResolverActor::new(resolver);

    let _address = spawn(actor);
  }

  #[tokio::test]
  async fn test_send_message_to_resolver() {
    let mut fs = InMemoryFileSystem::default();
    fs.write_file("/index.js", "console.log('Hello, world!');".into());

    let project_root = Cow::Owned("/".into());
    let cache = CacheCow::Owned(Cache::new(fs));
    let resolver = Resolver::parcel(project_root, cache);
    let actor = ResolverActor::new(resolver);

    let address = spawn(actor);

    address
      .send(ResolverMessage::Resolve {
        from: PathBuf::from("/"),
        specifier: "/index.js".into(),
        specifier_type: SpecifierType::Esm,
      })
      .await
      .unwrap();
  }
}
