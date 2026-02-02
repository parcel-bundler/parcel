// @flow strict-local

// UTF-8 BOM (Byte Order Mark) is the character \uFEFF at the start of a file.
// Some editors on Windows (like Visual Studio) add this to UTF-8 files.
// This function strips it if present to prevent JSON parse errors.

export default function stripBOM(content: string): string {
  // 0xFEFF is the UTF-8 BOM character code
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }
  return content;
}
