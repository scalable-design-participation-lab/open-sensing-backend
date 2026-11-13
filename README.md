# SensorModuleBackend

Google Cloud Function that receives sensor-module uplinks over HTTP and writes
them to a CloudSQL/Postgres database.

## Runtime

This project targets the **Node 20** Cloud Functions runtime (`nodejs20`).
`.nvmrc` pins the local major; `engines.node` is `>=20.0.0`.

```bash
nvm use
yarn install
```

Several Google Cloud SDK dependencies now ship majors that require Node 22 or
newer. The ranges in `package.json` for `@google-cloud/cloud-sql-connector`,
`@google-cloud/logging-winston` and `@google-cloud/secret-manager` are
deliberately pinned with `~` to the last releases that still support Node 20 —
widening them to `^` will pull in Node 22-only code that fails on this runtime.

## Deploying

`pushUpLink.js` registers the HTTP entry point `helloHttp`:

```bash
gcloud functions deploy helloHttp \
  --runtime=nodejs20 \
  --trigger-http \
  --entry-point=helloHttp
```

The database connection is read from the `host`, `database` and `password`
environment variables (user `postgres`, port `5432`); set these on the function
rather than committing them.

## Known gaps

These predate the Node 20 work and are untouched by it:

- `yarn start` runs `node pool.js`, but `pool.js` does not exist in this repo.
- `yarn test` runs `c8 mocha test/*.test.js`, but there is no `test/`
  directory, so the script always exits non-zero. There are no tests.
