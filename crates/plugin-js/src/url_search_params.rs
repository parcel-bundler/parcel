use std::{cell::RefCell, rc::Rc};

use rquickjs::{JsLifetime, class::Trace};
use url::Url;

#[derive(Clone, Trace, JsLifetime)]
#[rquickjs::class]
pub struct URLSearchParams {
  #[qjs(skip_trace)]
  pub url: Rc<RefCell<Url>>,
}

#[rquickjs::methods(rename_all = "camelCase")]
impl URLSearchParams {
  #[qjs(constructor)]
  pub fn url(input: Option<String>) -> Self {
    let url = if let Some(input) = input {
      let query = if !input.starts_with('?') {
        ["?", &input].concat()
      } else {
        input
      };
      Url::parse("http://example.com")
        .unwrap()
        .join(&query)
        .unwrap()
    } else {
      Url::parse("http://example.com").unwrap()
    };
    URLSearchParams {
      url: Rc::new(RefCell::new(url)),
    }
  }

  pub fn append(&mut self, name: String, value: String) {
    self
      .url
      .borrow_mut()
      .query_pairs_mut()
      .append_pair(&name, &value);
  }

  pub fn delete(&mut self, name: String, value: rquickjs::function::Opt<String>) {
    let pairs = self
      .url
      .borrow()
      .query_pairs()
      .filter(|(k, v)| {
        if let Some(value) = &value.0 {
          k != &name || v != value
        } else {
          k != &name
        }
      })
      .map(|(k, v)| (k.into_owned(), v.into_owned()))
      .collect::<Vec<(String, String)>>();

    if !pairs.is_empty() {
      self
        .url
        .borrow_mut()
        .query_pairs_mut()
        .clear()
        .extend_pairs(pairs);
    } else {
      self.url.borrow_mut().set_query(None);
    }
  }

  pub fn get(&self, name: String) -> Option<String> {
    self
      .url
      .borrow()
      .query_pairs()
      .find(|(k, _)| k == &name)
      .map(|(_, v)| v.into_owned())
  }

  pub fn get_all(&self, name: String) -> Vec<String> {
    self
      .url
      .borrow()
      .query_pairs()
      .filter(|(k, _)| k == &name)
      .map(|(_, v)| v.into_owned())
      .collect()
  }

  pub fn has(&self, name: String) -> bool {
    self.url.borrow().query_pairs().any(|(k, _)| k == name)
  }

  pub fn set(&mut self, name: String, value: String) {
    let mut found = false;
    let pairs = self
      .url
      .borrow()
      .query_pairs()
      .filter_map(|(k, v)| {
        if k == name {
          if !found {
            found = true;
            Some((k.into_owned(), value.clone()))
          } else {
            None
          }
        } else {
          Some((k.into_owned(), v.into_owned()))
        }
      })
      .collect::<Vec<(String, String)>>();

    self
      .url
      .borrow_mut()
      .query_pairs_mut()
      .clear()
      .extend_pairs(pairs);
  }

  pub fn sort(&mut self) {
    let mut pairs: Vec<(String, String)> = self.url.borrow().query_pairs().into_owned().collect();
    pairs.sort_by(|(a, _), (b, _)| a.cmp(b));

    self
      .url
      .borrow_mut()
      .query_pairs_mut()
      .clear()
      .extend_pairs(pairs);
  }

  pub fn to_string(&self) -> String {
    self.url.borrow().query().unwrap_or("").to_owned()
  }

  pub fn keys(&self) -> Vec<String> {
    self
      .url
      .borrow()
      .query_pairs()
      .map(|(k, _)| k.into_owned())
      .collect()
  }

  pub fn values(&self) -> Vec<String> {
    self
      .url
      .borrow()
      .query_pairs()
      .map(|(_, v)| v.into_owned())
      .collect()
  }

  pub fn entries(&self) -> Vec<Vec<String>> {
    self
      .url
      .borrow()
      .query_pairs()
      .map(|(k, v)| vec![k.into_owned(), v.into_owned()])
      .collect()
  }
}
