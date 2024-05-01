/// FileSystem implementation that delegates calls to a JS object
pub(crate) mod js_delegate_file_system;

/// In-memory file-system for testing
#[cfg(test)]
pub(crate) mod in_memory_file_system;
