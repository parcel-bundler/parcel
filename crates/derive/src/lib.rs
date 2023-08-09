use proc_macro::{self, TokenStream};
// use syn_helpers::{
//   derive_trait,
//   proc_macro2::Span,
//   quote,
//   syn::{parse_quote, DeriveInput, GenericParam, Ident, Stmt},
//   Constructable, FieldMut, HasAttributes, Trait, TraitItem, TypeOfSelf,
// };
use convert_case::{Case, Casing};
use proc_macro2::Span;
use quote::quote;
use syn::{
  parse_macro_input, parse_quote, Data, DataEnum, DeriveInput, Field, Fields, GenericArgument,
  Ident,
};

#[proc_macro_derive(ToJs)]
pub fn derive_to_js(input: TokenStream) -> TokenStream {
  let DeriveInput {
    ident: self_name,
    data,
    ..
  } = parse_macro_input!(input);
  let register = Ident::new(
    &format!("register_{}", self_name.to_string().to_case(Case::Snake)),
    Span::call_site(),
  );

  let output = match data {
    Data::Struct(s) => {
      let mut js: Vec<proc_macro2::TokenStream> = Vec::new();
      match &s.fields {
        Fields::Named(_) => {
          for field in s.fields.iter() {
            let name = field.ident.as_ref().unwrap();
            let ty = &field.ty;

            js.push(quote! {
              let name = stringify!(#name).to_case(Case::Camel);
              let offset = (std::ptr::addr_of!((*p).#name) as *const u8).offset_from(u8_ptr) as usize;
              let getter = <#ty>::js_getter(offset);
              let setter = <#ty>::js_setter(offset, "value");
              let type_name = <#ty>::ty();
              js.push_str(&format!(
  r#"
  get {name}(): {type_name} {{
    return {getter};
  }}

  set {name}(value: {type_name}): void {{
    {setter};
  }}
"#,
                name = name,
                getter = getter,
                setter = setter,
                type_name = type_name
              ));
            });
          }
        }
        _ => todo!(),
      }

      quote! {
        #[automatically_derived]
        impl ToJs for #self_name {
          fn to_js() -> String {
            use convert_case::{Case, Casing};
            let c = std::mem::MaybeUninit::uninit();
            let p: *const #self_name = c.as_ptr();
            let u8_ptr = p as *const u8;
            let mut js = String::new();
            let size = std::mem::size_of::<#self_name>();

            js.push_str(&format!(
      r#"export class {name} {{
  addr: number;

  constructor(addr?: number) {{
    this.addr = addr ?? binding.alloc({size});
  }}

  static get(addr: number): {name} {{
    return new {name}(addr);
  }}

  static set(addr: number, value: {name}): void {{
    HEAP.set(HEAP.subarray(value.addr, value.addr + {size}), addr);
  }}
"#,
              name = stringify!(#self_name),
              size = size,
            ));

            unsafe {
              #(#js);*;
            }

            js.push_str("}\n");
            js
          }
        }

        #[ctor::ctor]
        unsafe fn #register() {
          use std::io::Write;
          WRITE_CALLBACKS.push(|file| write!(file, "{}", #self_name::to_js()))
        }
      }
    }
    Data::Enum(e) => {
      let mut getters: Vec<proc_macro2::TokenStream> = Vec::new();
      let mut setters: Vec<proc_macro2::TokenStream> = Vec::new();
      let mut variants = Vec::new();
      for variant in e.variants.iter() {
        let name = &variant.ident;
        variants.push(format!("'{}'", name.to_string().to_case(Case::Kebab)));
        getters.push(quote! {
          let name = stringify!(#name).to_case(Case::Kebab);
          js.push_str(&format!(
        r#"
      case {}:
        return '{}';"#,
            #self_name::#name as usize,
            name
          ));
        });
        setters.push(quote! {
          let name = stringify!(#name).to_case(Case::Kebab);
          js.push_str(&format!(
        r#"
      case '{}':
        buf[addr] = {};
        break;"#,
            name,
            #self_name::#name as usize
          ));
        });
      }

      let variants = variants.join(" | ");
      quote! {
        #[automatically_derived]
        impl ToJs for #self_name {
          fn to_js() -> String {
            use convert_case::{Case, Casing};
            let size = std::mem::size_of::<#self_name>();
            let heap = match size {
              1 => "HEAP",
              2 => "HEAP_u16",
              4 => "HEAP_u32",
              _ => todo!()
            };
            let mut js = String::new();
            js.push_str(&format!(
              r#"type {name}Variants = {variants};

export class {name} {{
  static get(addr: number): {name}Variants {{
    switch ({heap}[addr]) {{"#,
              name = stringify!(#self_name),
              heap = heap,
              variants = #variants
            ));

            #(#getters);*;
            js.push_str(&format!(
              r#"
      default:
        throw new Error(`Unknown {name} value: ${{{heap}[addr]}}`);
    }}
  }}

  static set(addr: number, value: {name}Variants): void {{
    let buf = {heap};
    switch (value) {{"#,
              name = stringify!(#self_name),
              heap = heap,
            ));

            #(#setters);*;
            js.push_str(&format!(
              r#"
      default:
        throw new Error(`Unknown {} value: ${{value}}`);
    }}
  }}
}}
"#,
              stringify!(#self_name)
            ));

            js
          }
        }

        #[ctor::ctor]
        unsafe fn #register() {
          use std::io::Write;
          WRITE_CALLBACKS.push(|file| write!(file, "{}", #self_name::to_js()))
        }
      }
    }
    _ => todo!(),
  };

  output.into()
}

#[proc_macro_derive(JsValue)]
pub fn derive_js_value(input: TokenStream) -> TokenStream {
  let DeriveInput {
    ident: self_name,
    data,
    ..
  } = parse_macro_input!(input);

  let output = match data {
    // Special handling for newtype structs.
    Data::Struct(s) if s.fields.len() == 1 && matches!(s.fields, Fields::Unnamed(_)) => {
      let ty = &s.fields.iter().next().unwrap().ty;
      quote! {
        #[automatically_derived]
        impl JsValue for #self_name {
          fn js_getter(addr: usize) -> String {
            <#ty>::js_getter(addr)
          }

          fn js_setter(addr: usize, value: &str) -> String {
            <#ty>::js_setter(addr, value)
          }

          fn ty() -> String {
            <#ty>::ty()
          }
        }
      }
    }
    _ => {
      let ty = match data {
        Data::Enum(_) => format!("{}Variants", self_name.to_string()),
        Data::Struct(_) => self_name.to_string(),
        _ => todo!(),
      };
      quote! {
        #[automatically_derived]
        impl JsValue for #self_name {
          fn js_getter(addr: usize) -> String {
            format!("{}.get(this.addr + {:?})", stringify!(#self_name), addr)
          }

          fn js_setter(addr: usize, value: &str) -> String {
            format!("{}.set(this.addr + {:?}, {})", stringify!(#self_name), addr, value)
          }

          fn ty() -> String {
            #ty.into()
          }
        }
      }
    }
  };

  output.into()
}
