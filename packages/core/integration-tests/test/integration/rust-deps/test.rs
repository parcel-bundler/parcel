mod add;
use add::*;

#[no_mangle]
pub fn test(a: i32, b: i32) -> i32 {
    return add(a, b) + 5;
}
