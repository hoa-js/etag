## @hoajs/etag

ETag middleware for Hoa.

## Installation

```bash
$ npm i @hoajs/etag --save
```

## Quick Start

```js
import { Hoa } from 'hoa'
import { etag } from '@hoajs/etag'

const app = new Hoa()
app.use(etag())

app.use(async (ctx) => {
  ctx.res.body = `Hello, Hoa!`
})

export default app
```

## Documentation

The documentation is available on [hoa-js.com](https://hoa-js.com/middleware/etag.html)

## Test (100% coverage)

```sh
$ npm test
```

## License

MIT
