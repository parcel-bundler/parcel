use std::fs::File;
use std::io::Write;

use parcel_db::{codegen::*, ArenaVec, Symbol};

/// This program generates db.js, which includes JS accessors for all of our Rust types.
fn main() -> std::io::Result<()> {
  let mut file = File::create("src/db.js")?;
  write!(
    file,
    r#"// @flow
import {{ParcelDb}} from '../index';

let heapSymbol = global.Symbol('heap');
let heapU32Symbol = global.Symbol('heapU32');
let stringCacheSymbol = global.Symbol('stringCache');

// $FlowFixMe
ParcelDb.deserialize = (serialized) => {{
  // $FlowFixMe
  let res = ParcelDb.deserializeNative(serialized);
  init(res);
  return res;
}};

// $FlowFixMe
ParcelDb.create = (options) => {{
  let db = new ParcelDb(options);
  init(db);
  return db;
}};

// $FlowFixMe
ParcelDb.read = (filename, options) => {{
  // $FlowFixMe
  let db = ParcelDb._read(filename, options);
  init(db);
  return db;
}};

// $FlowFixMe
ParcelDb.fromBuffer = (buffer, options) => {{
  // $FlowFixMe
  let db = ParcelDb._fromBuffer(buffer, options);
  init(db);
  return db;
}};

function init(db: ParcelDb) {{
  db[heapSymbol] = [];
  db[heapU32Symbol] = [];
  db[stringCacheSymbol] = new Map();
  db.starSymbol = db.getStringId('*');
  db.defaultSymbol = db.getStringId('default');
}}

const PAGE_INDEX_SIZE = 16;
const PAGE_INDEX_SHIFT = 32 - PAGE_INDEX_SIZE;
const PAGE_INDEX_MASK = ((1 << PAGE_INDEX_SIZE) - 1) << PAGE_INDEX_SHIFT;
const PAGE_OFFSET_MASK = (1 << PAGE_INDEX_SHIFT) - 1;

function copy(db: ParcelDb, from: number, to: number, size: number) {{
  let fromPage = (from & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let fromOffset = from & PAGE_OFFSET_MASK;
  let heap = db[heapSymbol];
  let fromHeapPage = heap[fromPage] ??= db.getPage(fromPage);
  let toPage = (to & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let toOffset = to & PAGE_OFFSET_MASK;
  let toHeapPage = heap[toPage] ??= db.getPage(toPage);
  toHeapPage.set(fromHeapPage.subarray(fromOffset, fromOffset + size), toOffset);
}}

function readU8(db: ParcelDb, addr: number): number {{
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heap = db[heapSymbol];
  let heapPage = heap[page] ??= db.getPage(page);
  return heapPage[offset];
}}

function writeU8(db: ParcelDb, addr: number, value: number) {{
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heap = db[heapSymbol];
  let heapPage = heap[page] ??= db.getPage(page);
  return heapPage[offset] = value;
}}

function readU32(db: ParcelDb, addr: number): number {{
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heap = db[heapSymbol];
  let heap_u32 = db[heapU32Symbol];
  let heapPage = heap_u32[page] ??= new Uint32Array((heap[page] ??= db.getPage(page)).buffer);
  return heapPage[offset >> 2];
}}

function writeU32(db: ParcelDb, addr: number, value: number) {{
  let page = (addr & PAGE_INDEX_MASK) >> PAGE_INDEX_SHIFT;
  let offset = addr & PAGE_OFFSET_MASK;
  let heap = db[heapSymbol];
  let heap_u32 = db[heapU32Symbol];
  let heapPage = heap_u32[page] ??= new Uint32Array((heap[page] ??= db.getPage(page)).buffer);
  return heapPage[offset >> 2] = value;
}}

export function readCachedString(db: ParcelDb, addr: number): string {{
  let stringCache = db[stringCacheSymbol];
  let v = stringCache.get(addr);
  if (v != null) return v;
  v = db.readString(addr);
  stringCache.set(addr, v);
  return v;
}}

"#
  )?;

  write!(file, "{}", ArenaVec::<Symbol>::to_js())?;
  write!(file, "\n")?;

  unsafe {
    for cb in &WRITE_CALLBACKS {
      cb(&mut file)?;
      write!(file, "\n")?;
    }
  }

  println!("Wrote db.js");
  Ok(())
}
