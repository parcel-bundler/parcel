import fs from 'fs/promises';

export async function Files() {
  // await new Promise(resolve => setTimeout(resolve, 1000));
  let files = await fs.readdir(process.cwd());
  return (
    <ul>
      {files.map((file, i) => <li key={i}>{file}</li>)}
    </ul>
  );
}
