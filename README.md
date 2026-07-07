# @clovrix/sdk

Official Node.js / TypeScript client for the [Clovrix](https://clovrix.com) Public API — read and
write config and secret entries. Zero runtime dependencies (built-in `fetch`, **Node 18+**), with
first-class TypeScript types.

## Install

```bash
npm install @clovrix/sdk
```

## Quick start

```ts
import { ClovrixClient } from "@clovrix/sdk";

const clovrix = new ClovrixClient(); // reads CLOVRIX_TOKEN
const config = await clovrix.getEntries("backend", "production");      // key → value map
const db = await clovrix.getEntry("backend", "production", "DATABASE_URL");
```

Failed requests throw typed errors (`ClovrixNotFoundError`, `ClovrixBillingError`, …).

## Documentation

The full guide — authentication, writes, scoped access, error handling, configuration, and every
option, with side-by-side examples in Node.js, Python, and Go — lives at
**[clovrix.com/docs/sdk](https://clovrix.com/docs/sdk)**.

## License

MIT — see [LICENSE](./LICENSE).
