//! CoreFoundation and LaunchServices, for opening URLs in apps on macOS.

use std::{
  ffi::{c_char, c_void},
  os::unix::ffi::{OsStrExt, OsStringExt},
  path::{Path, PathBuf},
};

type CFTypeRef = *const c_void;

#[repr(C)]
struct CFArrayCallBacks {
  version: isize,
  retain: *const c_void,
  release: *const c_void,
  copy_description: *const c_void,
  equal: *const c_void,
}

// LSOpen.h packs its structs to 2 bytes.
#[repr(C, packed(2))]
struct LSLaunchURLSpec {
  app_url: CFTypeRef,
  item_urls: CFTypeRef,
  pass_thru_params: *const c_void,
  launch_flags: u32,
  async_ref_con: *mut c_void,
}

const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
/// Opens the items and brings the app to the front.
const K_LS_LAUNCH_DEFAULTS: u32 = 0x0000_0001;
const K_LS_ROLES_ALL: u32 = 0xFFFF_FFFF;

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
  static kCFTypeArrayCallBacks: CFArrayCallBacks;
  fn CFURLCreateWithBytes(
    allocator: CFTypeRef,
    bytes: *const u8,
    length: isize,
    encoding: u32,
    base: CFTypeRef,
  ) -> CFTypeRef;
  fn CFURLCreateFromFileSystemRepresentation(
    allocator: CFTypeRef,
    buffer: *const u8,
    length: isize,
    is_directory: u8,
  ) -> CFTypeRef;
  fn CFURLGetFileSystemRepresentation(
    url: CFTypeRef,
    resolve_against_base: u8,
    buffer: *mut u8,
    max_length: isize,
  ) -> u8;
  fn CFStringCreateWithBytes(
    allocator: CFTypeRef,
    bytes: *const u8,
    length: isize,
    encoding: u32,
    is_external_representation: u8,
  ) -> CFTypeRef;
  fn CFStringGetCString(string: CFTypeRef, buffer: *mut c_char, size: isize, encoding: u32) -> u8;
  fn CFArrayCreate(
    allocator: CFTypeRef,
    values: *const CFTypeRef,
    count: isize,
    callbacks: *const CFArrayCallBacks,
  ) -> CFTypeRef;
  fn CFArrayGetCount(array: CFTypeRef) -> isize;
  fn CFArrayGetValueAtIndex(array: CFTypeRef, index: isize) -> CFTypeRef;
  fn CFBundleCreate(allocator: CFTypeRef, url: CFTypeRef) -> CFTypeRef;
  fn CFBundleGetIdentifier(bundle: CFTypeRef) -> CFTypeRef;
  fn CFRelease(cf: CFTypeRef);
}

#[link(name = "CoreServices", kind = "framework")]
unsafe extern "C" {
  fn LSOpenFromURLSpec(spec: *const LSLaunchURLSpec, launched_url: *mut CFTypeRef) -> i32;
  fn LSCopyDefaultApplicationURLForURL(
    url: CFTypeRef,
    roles: u32,
    error: *mut CFTypeRef,
  ) -> CFTypeRef;
  fn LSCopyApplicationURLsForBundleIdentifier(
    bundle_identifier: CFTypeRef,
    error: *mut CFTypeRef,
  ) -> CFTypeRef;
}

/// A CoreFoundation object we own, released when dropped.
struct Owned(CFTypeRef);

impl Owned {
  fn new(object: CFTypeRef) -> Option<Self> {
    (!object.is_null()).then(|| Owned(object))
  }
}

impl Drop for Owned {
  fn drop(&mut self) {
    unsafe { CFRelease(self.0) };
  }
}

fn url(url: &str) -> Option<Owned> {
  Owned::new(unsafe {
    CFURLCreateWithBytes(
      std::ptr::null(),
      url.as_ptr(),
      url.len() as isize,
      K_CF_STRING_ENCODING_UTF8,
      std::ptr::null(),
    )
  })
}

fn file_url(path: &Path) -> Option<Owned> {
  let path = path.as_os_str().as_bytes();
  Owned::new(unsafe {
    CFURLCreateFromFileSystemRepresentation(std::ptr::null(), path.as_ptr(), path.len() as isize, 1)
  })
}

fn path(url: CFTypeRef) -> Option<PathBuf> {
  let mut buffer = vec![0u8; 4096];
  let ok =
    unsafe { CFURLGetFileSystemRepresentation(url, 1, buffer.as_mut_ptr(), buffer.len() as isize) };
  if ok == 0 {
    return None;
  }
  let len = buffer.iter().position(|&b| b == 0)?;
  buffer.truncate(len);
  Some(PathBuf::from(std::ffi::OsString::from_vec(buffer)))
}

fn string(string: &str) -> Option<Owned> {
  Owned::new(unsafe {
    CFStringCreateWithBytes(
      std::ptr::null(),
      string.as_ptr(),
      string.len() as isize,
      K_CF_STRING_ENCODING_UTF8,
      0,
    )
  })
}

fn to_string(string: CFTypeRef) -> Option<String> {
  let mut buffer = vec![0u8; 1024];
  let ok = unsafe {
    CFStringGetCString(
      string,
      buffer.as_mut_ptr() as *mut c_char,
      buffer.len() as isize,
      K_CF_STRING_ENCODING_UTF8,
    )
  };
  if ok == 0 {
    return None;
  }
  let len = buffer.iter().position(|&b| b == 0)?;
  buffer.truncate(len);
  String::from_utf8(buffer).ok()
}

/// Opens `url` in the app at `app` with LaunchServices, like `open -a app url`, and brings it to the
/// front.
pub fn open_url_in_app(app: &Path, url: &str) -> Result<(), ()> {
  let (Some(app), Some(url)) = (file_url(app), self::url(url)) else {
    return Err(());
  };
  let item_urls =
    Owned::new(unsafe { CFArrayCreate(std::ptr::null(), &url.0, 1, &kCFTypeArrayCallBacks) })
      .ok_or(())?;
  let spec = LSLaunchURLSpec {
    app_url: app.0,
    item_urls: item_urls.0,
    pass_thru_params: std::ptr::null(),
    launch_flags: K_LS_LAUNCH_DEFAULTS,
    async_ref_con: std::ptr::null_mut(),
  };
  let status = unsafe { LSOpenFromURLSpec(&spec, std::ptr::null_mut()) };
  if status == 0 { Ok(()) } else { Err(()) }
}

/// The app that opens `url` by default, e.g. the default browser for `http:` URLs.
pub fn default_app_for_url(url: &str) -> Option<PathBuf> {
  let url = self::url(url)?;
  let app = Owned::new(unsafe {
    LSCopyDefaultApplicationURLForURL(url.0, K_LS_ROLES_ALL, std::ptr::null_mut())
  })?;
  path(app.0)
}

/// An installed app with the bundle identifier `bundle_identifier`.
pub fn app_with_bundle_identifier(bundle_identifier: &str) -> Option<PathBuf> {
  let bundle_identifier = string(bundle_identifier)?;
  let apps = Owned::new(unsafe {
    LSCopyApplicationURLsForBundleIdentifier(bundle_identifier.0, std::ptr::null_mut())
  })?;
  if unsafe { CFArrayGetCount(apps.0) } == 0 {
    return None;
  }
  path(unsafe { CFArrayGetValueAtIndex(apps.0, 0) })
}

/// The bundle identifier of the app at `app`, e.g. `com.google.Chrome`.
pub fn bundle_identifier(app: &Path) -> Option<String> {
  let url = file_url(app)?;
  let bundle = Owned::new(unsafe { CFBundleCreate(std::ptr::null(), url.0) })?;
  let identifier = unsafe { CFBundleGetIdentifier(bundle.0) };
  if identifier.is_null() {
    return None;
  }
  to_string(identifier)
}

/// Apple Events, the interface that apps' AppleScript dictionaries describe. Events are built and
/// sent directly rather than with AppleScript.
pub mod apple_events {
  use std::{ffi::c_void, mem::ManuallyDrop};

  /// A four-character code, e.g. of an event, or a class in an app's scripting dictionary.
  pub const fn code(code: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*code)
  }

  const TYPE_NULL: u32 = code(b"null");
  const TYPE_TYPE: u32 = code(b"type");
  const TYPE_SINT32: u32 = code(b"long");
  const TYPE_UTF8_TEXT: u32 = code(b"utf8");
  const TYPE_ABSOLUTE_ORDINAL: u32 = code(b"abso");
  const TYPE_APPLICATION_BUNDLE_ID: u32 = code(b"bund");
  const TYPE_WILD_CARD: u32 = code(b"****");
  const K_AE_ALL: u32 = code(b"all ");
  const FORM_ABSOLUTE_POSITION: u32 = code(b"indx");
  const FORM_PROPERTY_ID: u32 = code(b"prop");
  const C_PROPERTY: u32 = code(b"prop");
  pub const KEY_DIRECT_OBJECT: u32 = code(b"----");
  const KEY_AE_DATA: u32 = code(b"data");
  const KEY_ERROR_NUMBER: u32 = code(b"errn");
  pub const C_WINDOW: u32 = code(b"cwin");
  pub const P_INDEX: u32 = code(b"pidx");
  const K_AE_WAIT_REPLY: i32 = 0x0000_0003;
  const K_AE_CAN_INTERACT: i32 = 0x0000_0020;
  const K_AUTO_GENERATE_RETURN_ID: i16 = -1;
  const K_ANY_TRANSACTION_ID: i32 = 0;
  /// Five seconds, in ticks.
  const TIMEOUT: isize = 300;

  // AEDataModel.h packs its structs to 2 bytes.
  #[repr(C, packed(2))]
  struct AEDesc {
    descriptor_type: u32,
    data_handle: *mut c_void,
  }

  #[link(name = "CoreServices", kind = "framework")]
  unsafe extern "C" {
    fn AECreateDesc(type_code: u32, data: *const c_void, size: isize, result: *mut AEDesc) -> i16;
    fn AEDisposeDesc(desc: *mut AEDesc) -> i16;
    fn CreateObjSpecifier(
      desired_class: u32,
      container: *mut AEDesc,
      key_form: u32,
      key_data: *mut AEDesc,
      dispose_inputs: u8,
      result: *mut AEDesc,
    ) -> i16;
    fn AECreateAppleEvent(
      event_class: u32,
      event_id: u32,
      target: *const AEDesc,
      return_id: i16,
      transaction_id: i32,
      result: *mut AEDesc,
    ) -> i16;
    fn AEPutParamDesc(event: *mut AEDesc, keyword: u32, desc: *const AEDesc) -> i16;
    fn AESendMessage(
      event: *const AEDesc,
      reply: *mut AEDesc,
      send_mode: i32,
      timeout: isize,
    ) -> i32;
    fn AEGetParamDesc(
      event: *const AEDesc,
      keyword: u32,
      desired_type: u32,
      result: *mut AEDesc,
    ) -> i16;
    fn AECountItems(list: *const AEDesc, count: *mut isize) -> i16;
    fn AEGetNthDesc(
      list: *const AEDesc,
      index: isize,
      desired_type: u32,
      keyword: *mut u32,
      result: *mut AEDesc,
    ) -> i16;
    fn AECoerceDesc(desc: *const AEDesc, to_type: u32, result: *mut AEDesc) -> i16;
    fn AEGetDescDataSize(desc: *const AEDesc) -> isize;
    fn AEGetDescData(desc: *const AEDesc, data: *mut c_void, max_size: isize) -> i16;
    fn AEDeterminePermissionToAutomateTarget(
      target: *const AEDesc,
      event_class: u32,
      event_id: u32,
      ask_user_if_needed: u8,
    ) -> i32;
  }

  /// A descriptor we own, disposed when dropped.
  pub struct Desc(AEDesc);

  impl Drop for Desc {
    fn drop(&mut self) {
      unsafe { AEDisposeDesc(&mut self.0) };
    }
  }

  impl Desc {
    pub fn null() -> Desc {
      Desc(AEDesc {
        descriptor_type: TYPE_NULL,
        data_handle: std::ptr::null_mut(),
      })
    }

    fn new(type_code: u32, data: &[u8]) -> Result<Desc, i32> {
      let mut desc = Desc::null();
      check(unsafe {
        AECreateDesc(
          type_code,
          data.as_ptr() as *const c_void,
          data.len() as isize,
          &mut desc.0,
        )
      })?;
      Ok(desc)
    }

    pub fn int(value: i32) -> Result<Desc, i32> {
      Desc::new(TYPE_SINT32, &value.to_ne_bytes())
    }

    pub fn text(value: &str) -> Result<Desc, i32> {
      Desc::new(TYPE_UTF8_TEXT, value.as_bytes())
    }

    fn type_code(value: u32) -> Result<Desc, i32> {
      Desc::new(TYPE_TYPE, &value.to_ne_bytes())
    }

    /// An object specifier, e.g. for `window 1`.
    fn object(class: u32, container: Desc, form: u32, key: Desc) -> Result<Desc, i32> {
      let mut container = ManuallyDrop::new(container);
      let mut key = ManuallyDrop::new(key);
      let mut object = Desc::null();
      // Disposes the container and key.
      check(unsafe {
        CreateObjSpecifier(class, &mut container.0, form, &mut key.0, 1, &mut object.0)
      })?;
      Ok(object)
    }

    /// `every <class> of <container>`.
    pub fn every(class: u32, container: Desc) -> Result<Desc, i32> {
      let all = Desc::new(TYPE_ABSOLUTE_ORDINAL, &K_AE_ALL.to_ne_bytes())?;
      Desc::object(class, container, FORM_ABSOLUTE_POSITION, all)
    }

    /// `<class> <index> of <container>`, counting from 1.
    pub fn index(class: u32, container: Desc, index: usize) -> Result<Desc, i32> {
      Desc::object(
        class,
        container,
        FORM_ABSOLUTE_POSITION,
        Desc::int(index as i32)?,
      )
    }

    /// `<property> of <container>`.
    pub fn property(property: u32, container: Desc) -> Result<Desc, i32> {
      Desc::object(
        C_PROPERTY,
        container,
        FORM_PROPERTY_ID,
        Desc::type_code(property)?,
      )
    }

    pub fn items(&self) -> Result<Vec<Desc>, i32> {
      let mut count = 0;
      check(unsafe { AECountItems(&self.0, &mut count) })?;
      (1..=count)
        .map(|index| {
          let mut item = Desc::null();
          check(unsafe {
            AEGetNthDesc(
              &self.0,
              index,
              TYPE_WILD_CARD,
              std::ptr::null_mut(),
              &mut item.0,
            )
          })?;
          Ok(item)
        })
        .collect()
    }

    /// The text this holds, e.g. a tab's URL. `None` for other values, e.g. `missing value`.
    pub fn to_text(&self) -> Option<String> {
      let descriptor_type = self.0.descriptor_type;
      if ![TYPE_UTF8_TEXT, code(b"utxt"), code(b"TEXT")].contains(&descriptor_type) {
        return None;
      }
      let mut text = Desc::null();
      check(unsafe { AECoerceDesc(&self.0, TYPE_UTF8_TEXT, &mut text.0) }).ok()?;
      let size = unsafe { AEGetDescDataSize(&text.0) };
      let mut data = vec![0u8; size.max(0) as usize];
      check(unsafe { AEGetDescData(&text.0, data.as_mut_ptr() as *mut c_void, size) }).ok()?;
      String::from_utf8(data).ok()
    }
  }

  fn check(status: impl Into<i32>) -> Result<(), i32> {
    match status.into() {
      0 => Ok(()),
      status => Err(status),
    }
  }

  /// A running app that receives Apple Events.
  pub struct App(Desc);

  impl App {
    pub fn new(bundle_identifier: &str) -> Result<App, i32> {
      Ok(App(Desc::new(
        TYPE_APPLICATION_BUNDLE_ID,
        bundle_identifier.as_bytes(),
      )?))
    }

    /// Asks the user whether to allow controlling the app, the first time. Fails if the app isn't
    /// running, without asking.
    pub fn request_permission(&self) -> Result<(), i32> {
      check(unsafe {
        AEDeterminePermissionToAutomateTarget(&self.0.0, TYPE_WILD_CARD, TYPE_WILD_CARD, 1)
      })
    }

    /// Sends the event `class`/`id`, and returns the reply's result.
    pub fn send(
      &self,
      class: &[u8; 4],
      id: &[u8; 4],
      params: Vec<(u32, Desc)>,
    ) -> Result<Desc, i32> {
      let mut event = Desc::null();
      check(unsafe {
        AECreateAppleEvent(
          code(class),
          code(id),
          &self.0.0,
          K_AUTO_GENERATE_RETURN_ID,
          K_ANY_TRANSACTION_ID,
          &mut event.0,
        )
      })?;
      for (keyword, param) in &params {
        check(unsafe { AEPutParamDesc(&mut event.0, *keyword, &param.0) })?;
      }
      let mut reply = Desc::null();
      check(unsafe {
        AESendMessage(
          &event.0,
          &mut reply.0,
          K_AE_WAIT_REPLY | K_AE_CAN_INTERACT,
          TIMEOUT,
        )
      })?;
      let mut error = Desc::null();
      if unsafe { AEGetParamDesc(&reply.0, KEY_ERROR_NUMBER, TYPE_SINT32, &mut error.0) } == 0 {
        let mut number = [0u8; 4];
        unsafe { AEGetDescData(&error.0, number.as_mut_ptr() as *mut c_void, 4) };
        check(i32::from_ne_bytes(number))?;
      }
      let mut result = Desc::null();
      // Events like `set` have no result.
      unsafe { AEGetParamDesc(&reply.0, KEY_DIRECT_OBJECT, TYPE_WILD_CARD, &mut result.0) };
      Ok(result)
    }

    pub fn get(&self, object: Desc) -> Result<Desc, i32> {
      self.send(b"core", b"getd", vec![(KEY_DIRECT_OBJECT, object)])
    }

    pub fn set(&self, object: Desc, value: Desc) -> Result<(), i32> {
      self
        .send(
          b"core",
          b"setd",
          vec![(KEY_DIRECT_OBJECT, object), (KEY_AE_DATA, value)],
        )
        .map(drop)
    }
  }

  #[cfg(test)]
  mod tests {
    use super::*;

    #[test]
    fn builds_and_reads_descriptors() {
      // `URL of every tab of every window`, without sending it anywhere.
      Desc::property(
        code(b"URL "),
        Desc::every(code(b"CrTb"), Desc::every(C_WINDOW, Desc::null()).unwrap()).unwrap(),
      )
      .unwrap();
      assert_eq!(
        Desc::text("http://localhost:1234/a")
          .unwrap()
          .to_text()
          .as_deref(),
        Some("http://localhost:1234/a")
      );
      assert_eq!(Desc::int(1).unwrap().to_text(), None);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn finds_apps_and_their_bundle_identifiers() {
    // Safari is always installed.
    let safari = app_with_bundle_identifier("com.apple.Safari").unwrap();
    assert!(safari.ends_with("Safari.app"), "{safari:?}");
    assert_eq!(
      bundle_identifier(&safari).as_deref(),
      Some("com.apple.Safari")
    );
    assert!(app_with_bundle_identifier("com.example.missing").is_none());

    let browser = default_app_for_url("http://localhost/").unwrap();
    assert!(bundle_identifier(&browser).is_some(), "{browser:?}");
  }

  #[test]
  fn fails_to_open_urls_in_missing_apps() {
    // Exercises the LaunchServices call without opening anything.
    assert!(open_url_in_app(Path::new("/nonexistent/Missing.app"), "zed://file/a.js").is_err());
  }
}
