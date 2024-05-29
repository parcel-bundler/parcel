mod message;
mod response;

use std::sync::mpsc::Sender;

pub use self::message::*;
pub use self::response::*;

pub type AdapterMessageResponse = (message::AdapterMessage, Sender<response::AdapterResponse>);
