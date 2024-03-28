use convert_case::{Case, Casing};
use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::quote;
use syn::{parse_macro_input, Data, DeriveInput, Fields, Ident, Type};

#[proc_macro_derive(ToJs, attributes(js_type))]
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
            let ty = if let Some(attr) = field
              .attrs
              .iter()
              .find(|attr| attr.path.is_ident("js_type"))
            {
              let ty: Type = attr.parse_args().unwrap();
              ty
            } else {
              field.ty.clone()
            };

            js.push(quote! {
              let name = stringify!(#name).to_case(Case::Camel);
              let offset = (std::ptr::addr_of!((*p).#name) as *const u8).offset_from(u8_ptr) as usize;
              let getter = <#ty>::js_getter("this.db", "this.addr", offset);
              let setter = <#ty>::js_setter("this.db", "this.addr", offset, "value");
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
            let id = crate::codegen::type_id::<#self_name>();

            js.push_str(&format!(
      r#"export opaque type {name}Addr = number;

export class {name} {{
  static typeId: number = {id};
  db: ParcelDb;
  addr: {name}Addr;

  constructor(db: ParcelDb, addr?: {name}Addr) {{
    this.db = db;
    this.addr = addr ?? db.alloc({id});
  }}

  static get(db: ParcelDb, addr: {name}Addr): {name} {{
    return new {name}(db, addr);
  }}

  static set(db: ParcelDb, addr: {name}Addr, value: {name}): void {{
    copy(db, value.addr, addr, {size});
  }}

  dealloc() {{
    this.db.dealloc({id}, this.addr);
  }}
"#,
              name = stringify!(#self_name),
              id = id,
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
          crate::codegen::WRITE_CALLBACKS.push(|file| write!(file, "{}", #self_name::to_js()));
          crate::codegen::register_type::<#self_name>(crate::codegen::Factory {
            alloc: #self_name::alloc_ptr,
            dealloc: #self_name::dealloc_ptr,
            extend_vec: #self_name::extend_vec,
          });
        }
      }
    }
    Data::Enum(e) => {
      let mut getters: Vec<proc_macro2::TokenStream> = Vec::new();
      let mut setters: Vec<proc_macro2::TokenStream> = Vec::new();
      let mut variants = Vec::new();
      let mut has_other = false;
      for variant in e.variants.iter() {
        let name = &variant.ident;

        if variant.fields.len() == 1 && matches!(variant.fields, Fields::Unnamed(_)) {
          if has_other {
            panic!("Only one other variant can be defined");
          }
          has_other = true;
          let ty = variant.fields.iter().next().unwrap().ty.clone();
          variants.push(quote! {
            variants.push(<#ty>::ty());
          });
          getters.push(quote! {
            let name = stringify!(#name).to_case(Case::Kebab);
            let value_offset = crate::codegen::enum_value_offset(#self_name::#name, |v| match v {
              #self_name::#name(ref v) => v,
              _ => unreachable!()
            });
            js.push_str(&format!(
          r#"
      case {}:
        return {};"#,
              crate::codegen::discriminant_value(#self_name::#name(crate::codegen::uninit()), offset, size),
              <#ty>::js_getter("db", "addr", value_offset)
            ));
          });
          setters.push(quote! {
            let value_offset = crate::codegen::enum_value_offset(#self_name::#name, |v| match v {
              #self_name::#name(ref v) => v,
              _ => unreachable!()
            });
            js.push_str(&format!(
          r#"
      default:
        write(db, addr + {offset}, {discriminant});
        {setter};
        break;"#,
              offset = offset,
              discriminant = crate::codegen::discriminant_value(#self_name::#name(crate::codegen::uninit()), offset, size),
              setter = <#ty>::js_setter("db", "addr", value_offset, "value")
            ));
          });
        } else if variant.fields.is_empty() {
          variants.push(quote! {
            variants.push(format!("'{}'", stringify!(#name).to_case(Case::Kebab)));
          });
          getters.push(quote! {
            let name = stringify!(#name).to_case(Case::Kebab);
            js.push_str(&format!(
          r#"
      case {}:
        return '{}';"#,
              crate::codegen::discriminant_value(#self_name::#name, offset, size),
              name
            ));
          });
          setters.push(quote! {
            let name = stringify!(#name).to_case(Case::Kebab);
            js.push_str(&format!(
          r#"
      case '{name}':
        write(db, addr + {offset}, {value});
        break;"#,
              name = name,
              offset = offset,
              value = crate::codegen::discriminant_value(#self_name::#name, offset, size),
            ));
          });
        } else {
          todo!()
        }
      }

      let first_variant = e.variants.iter().next().unwrap().ident.clone();
      quote! {
        #[automatically_derived]
        impl ToJs for #self_name {
          fn to_js() -> String {
            use convert_case::{Case, Casing};
            let (offset, size) = crate::codegen::discriminant(#self_name::#first_variant, |v| matches!(v, #self_name::#first_variant));
            let heap = match size {
              1 => "U8",
              2 => "U16",
              4 => "U32",
              _ => todo!()
            };
            let mut variants = Vec::new();
            #(#variants);*;

            let mut js = String::new();
            js.push_str(&format!(
              r#"type {name}Variants = {variants};

export class {name} {{
  static get(db: ParcelDb, addr: number): {name}Variants {{
    switch (read{heap}(db, addr + {offset})) {{"#,
              name = stringify!(#self_name),
              heap = heap,
              offset = offset,
              variants = variants.join(" | ")
            ));

            #(#getters);*;
            js.push_str(&format!(
              r#"
      default:
        throw new Error(`Unknown {name} value: ${{read{heap}(db, addr)}}`);
    }}
  }}

  static set(db: ParcelDb, addr: number, value: {name}Variants): void {{
    let write = write{heap};
    switch (value) {{"#,
              name = stringify!(#self_name),
              heap = heap,
            ));

            #(#setters);*;
            if !#has_other {
              js.push_str(&format!(r#"
      default:
        throw new Error(`Unknown {} value: ${{value}}`);"#,
                stringify!(#self_name)
              ));
            }
          js.push_str(r#"
    }
  }
}
"#);

            js
          }
        }

        #[ctor::ctor]
        unsafe fn #register() {
          use std::io::Write;
          crate::codegen::WRITE_CALLBACKS.push(|file| write!(file, "{}", #self_name::to_js()))
        }
      }
    }
    _ => todo!(),
  };

  output.into()
}

#[proc_macro_derive(JsValue, attributes(js_type))]
pub fn derive_js_value(input: TokenStream) -> TokenStream {
  let DeriveInput {
    ident: self_name,
    data,
    attrs,
    ..
  } = parse_macro_input!(input);

  let output = match data {
    // Special handling for newtype structs.
    Data::Struct(s) if s.fields.len() == 1 && matches!(s.fields, Fields::Unnamed(_)) => {
      let ty = &s.fields.iter().next().unwrap().ty;
      let js_type = if let Some(attr) = attrs.iter().find(|attr| attr.path.is_ident("js_type")) {
        let ty: Ident = attr.parse_args().unwrap();
        quote! { stringify!(#ty).to_string() }
      } else {
        quote! { <#ty>::ty() }
      };

      quote! {
        #[automatically_derived]
        impl JsValue for #self_name {
          fn js_getter(db: &str, addr: &str, offset: usize) -> String {
            <#ty>::js_getter(db, addr, offset)
          }

          fn js_setter(db: &str, addr: &str, offset: usize, value: &str) -> String {
            <#ty>::js_setter(db, addr, offset, value)
          }

          fn ty() -> String {
            #js_type
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
          fn js_getter(db: &str, addr: &str, offset: usize) -> String {
            format!("{}.get({}, {} + {})", stringify!(#self_name), db, addr, offset)
          }

          fn js_setter(db: &str, addr: &str, offset: usize, value: &str) -> String {
            format!("{}.set({}, {} + {}, {})", stringify!(#self_name), db, addr, offset, value)
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

#[proc_macro_derive(SlabAllocated)]
pub fn derive_slab_allocated(input: TokenStream) -> TokenStream {
  let DeriveInput {
    ident: self_name,
    generics,
    ..
  } = parse_macro_input!(input);

  let slab_name = Ident::new(
    &format!("{}_slab", self_name.to_string().to_case(Case::Snake)),
    Span::call_site(),
  );

  let (impl_generics, ty_generics, where_clause) = generics.split_for_impl();

  let output = quote! {

    #[automatically_derived]
    impl #impl_generics SlabAllocated for #self_name #ty_generics #where_clause {
      fn alloc(count: u32) -> (u32, *mut #self_name) {
        let addr = crate::SLABS.with_borrow_mut(|s| {
          let slabs = s.as_mut().unwrap();
          slabs.#slab_name.alloc(count)
        });

        unsafe { (addr, crate::current_heap().get(addr)) }
      }

      fn dealloc(addr: u32, count: u32) {
        crate::SLABS.with_borrow_mut(|s| {
          let slabs = s.as_mut().unwrap();

          slabs.#slab_name.dealloc(addr, count)
        })
      }
    }
  };

  output.into()
}

#[proc_macro_derive(ArenaAllocated)]
pub fn derive_arena_allocated(input: TokenStream) -> TokenStream {
  let DeriveInput {
    ident: self_name,
    generics,
    ..
  } = parse_macro_input!(input);

  let (impl_generics, ty_generics, where_clause) = generics.split_for_impl();
  let output = quote! {
    #[automatically_derived]
    impl #impl_generics ArenaAllocated for #self_name #ty_generics #where_clause {}
  };

  output.into()
}
