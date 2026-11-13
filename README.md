# SensorModuleBackend

Google Cloud Function that receives sensor-module uplinks over HTTP and writes
them to a CloudSQL/Postgres database.

## Runtime

This project targets the **Node 22** Cloud Functions runtime (`nodejs22`).
`nodejs20` was decommissioned on 2026-10-30 and `nodejs18` on 2025-10-30;
functions can no longer be created or updated on either. `nodejs22` is
supported until its deprecation on 2027-04-30 (decommission 2027-10-31).
See https://cloud.google.com/functions/docs/runtime-support.

`.nvmrc` pins the local major; `engines.node` is `>=22.12.0`. The floor is
22.12 rather than 22.0 because c8 and mocha require `^22.12.0`; the runtime
dependencies themselves are satisfied by any 22.x.

```bash
nvm use
yarn install
```

## Deploying

`pushUpLink.js` registers the HTTP entry point `helloHttp`:

```bash
gcloud functions deploy helloHttp \
  --runtime=nodejs22 \
  --trigger-http \
  --entry-point=helloHttp
```

The database connection is read from the `host`, `database` and `password`
environment variables (user `postgres`, port `5432`); set these on the function
rather than committing them.

## Known gaps

These predate the Node 22 work and are untouched by it:

- `yarn start` runs `node pool.js`, but `pool.js` does not exist in this repo.
- Seven of the nine runtime dependencies are never imported. Only `pg` and
  `@google-cloud/functions-framework` are actually used.
- `yarn test` runs `c8 mocha test/*.test.js`, but there is no `test/`
  directory, so the script always exits non-zero. There are no tests.
