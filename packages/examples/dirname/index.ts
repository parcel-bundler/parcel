import * as fs from "fs"

function run(): void {
  const data = fs.readFileSync(`${__dirname}/data/test.txt`, 'utf-8')
  const filename = __filename

  console.log({ data, filename })
}

run()