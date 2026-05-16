# claw-1password

1Password SecretRef provider integration for OpenClaw.

This plugin keeps 1Password-specific resolution outside OpenClaw core. It
declares a `secretProviderIntegrations.onepassword` preset that materializes an
OpenClaw-managed Node exec secret provider.

## 1Password Hosting Model

1Password itself is not generally self-hosted. The self-hostable component is
1Password Connect, which runs in your infrastructure and exposes an API bridge
for vault data from your 1Password account.

This plugin uses the official `op` CLI. The CLI can resolve secrets with:

- `OP_SERVICE_ACCOUNT_TOKEN`
- `OP_CONNECT_HOST` and `OP_CONNECT_TOKEN` for 1Password Connect
- an existing authenticated `op` CLI session

## SecretRef IDs

The recommended id format is a native 1Password secret reference:

```json
{ "source": "exec", "provider": "onepassword", "id": "op://Engineering/OpenRouter/apiKey" }
```

The resolver also accepts:

```text
<vault>/<item>/<field>
<vault>/<item>/<section>/<field>
```

If `CLAW_1PASSWORD_VAULT` is set, it also accepts:

```text
<item>/<field>
```

## Environment

Required for real 1Password reads:

- the `op` CLI on `PATH`, or `CLAW_1PASSWORD_OP` pointing to the CLI
- one of the authentication modes supported by `op`

Common auth environment:

- `OP_SERVICE_ACCOUNT_TOKEN`
- `OP_CONNECT_HOST`
- `OP_CONNECT_TOKEN`
- `OP_ACCOUNT`

Optional plugin environment:

- `CLAW_1PASSWORD_OP` (default: `op`)
- `CLAW_1PASSWORD_VAULT`

Test fallback:

- `CLAW_1PASSWORD_VALUES_JSON`

## Local Smoke

```bash
printf '%s\n' '{"protocolVersion":1,"ids":["op://Engineering/OpenRouter/apiKey"]}' \
  | CLAW_1PASSWORD_VALUES_JSON='{"op://Engineering/OpenRouter/apiKey":"not-a-real-value"}' \
    ./onepassword-secret-ref-resolver.js
```

Expected:

```json
{"protocolVersion":1,"values":{"op://Engineering/OpenRouter/apiKey":"not-a-real-value"},"errors":{}}
```

## Install In OpenClaw Source Checkout

Until this plugin is packaged with compiled runtime output, load it as a source
plugin:

```bash
openclaw config patch --stdin <<'JSON5'
{
  plugins: {
    load: {
      paths: ["/absolute/path/to/claw-1password"],
    },
  },
}
JSON5
```

Then configure SecretRefs that use provider `onepassword`.

The managed provider config points back to this plugin instead of copying the
resolver command:

```json5
{
  secrets: {
    providers: {
      onepassword: {
        source: "exec",
        pluginIntegration: {
          pluginId: "1password",
          integrationId: "onepassword",
        },
      },
    },
  },
}
```

## Tests

```bash
npm install
npm test
```
