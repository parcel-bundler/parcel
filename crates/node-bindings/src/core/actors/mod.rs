//! This implements a very simple actor model abstraction based around Futures
//!
//! An actor is a Task that can receive messages and respond to them.
//!
//! The actor runs in a logical thread (a tokio task) and manages some state.
use std::future::Future;

use tokio::sync::mpsc::Sender;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

/// An actor is some data that can receive messages and respond to them.
///
/// The actor handle function will be called on a loop on a logical thread (a tokio task)
/// when the actor is spawned with `spawn`.
pub trait Actor {
  type Message;
  type Response;

  fn handle(
    &mut self,
    message: Self::Message,
  ) -> impl Future<Output = anyhow::Result<Self::Response>> + Send;
}

/// Messages into the actor task
struct ActorPayload<A: Actor> {
  message: A::Message,
  response: Option<oneshot::Sender<anyhow::Result<A::Response>>>,
}

/// A mailbox to send messages to an `Actor`.
pub struct Address<A>
where
  A: Actor + 'static,
  A::Message: Send + Sync,
  A::Response: Send,
{
  tx: Sender<ActorPayload<A>>,
  handle: JoinHandle<()>,
}

impl<A> Address<A>
where
  A: Actor + 'static,
  A::Message: Send + Sync,
  A::Response: Send,
{
  /// Send messages to this `Actor` and await the response.
  pub async fn send(&self, message: A::Message) -> anyhow::Result<A::Response> {
    let (tx, rx) = oneshot::channel();
    self
      .tx
      .send(ActorPayload {
        message,
        response: Some(tx),
      })
      .await?;

    let response = rx.await??;
    Ok(response)
  }

  /// Send messages to this `Actor` but don't await the response.
  async fn tell(&self, message: A::Message) -> anyhow::Result<()> {
    self
      .tx
      .send(ActorPayload {
        message,
        response: None,
      })
      .await?;

    Ok(())
  }
}

/// Spawn an `Actor` on a new tokio task and return an `Address` to send messages to it.
pub fn spawn<A>(mut actor: A) -> Address<A>
where
  A: Actor + 'static + Send,
  A::Message: Send + Sync,
  A::Response: Send,
{
  let (tx, mut rx) = tokio::sync::mpsc::channel(100);
  let handle = tokio::spawn(async move {
    while let Some(ActorPayload { message, response }) = rx.recv().await {
      let result = actor.handle(message).await;

      if let Some(response) = response {
        // errors will only happen if the receiver is closed, which means we don't care
        let _ = response.send(result);
      }
    }
  });

  Address { tx, handle }
}

#[cfg(test)]
mod test {
  use std::time::Duration;

  use super::*;

  #[test]
  fn test_create_actor() {
    struct MyActor;

    impl Actor for MyActor {
      type Message = ();
      type Response = ();

      async fn handle(&mut self, _message: Self::Message) -> anyhow::Result<()> {
        let _result = tokio::fs::read("Cargo.toml").await?;
        Ok(())
      }
    }
  }

  #[tokio::test]
  async fn test_counter_actor() {
    struct Counter {
      count: usize,
    }

    impl Actor for Counter {
      type Message = ();
      type Response = usize;

      async fn handle(&mut self, _: Self::Message) -> anyhow::Result<Self::Response> {
        self.count += 1;
        tokio::time::sleep(Duration::from_millis(1)).await;
        Ok(self.count)
      }
    }

    let address = spawn(Counter { count: 0 });
    let count = address.send(()).await.unwrap();
    assert_eq!(count, 1);
    let count = address.send(()).await.unwrap();
    assert_eq!(count, 2);
  }
}
