type Config = {
  plugins: {
    resolve: string
    options: {
      [key: string]: string
    }
  }[]
}

const config: Config = {
  plugins: [
    {
      resolve: `name`,
      options: {
        path: `${__dirname}/data`
      }
    }
  ]
}

export default config