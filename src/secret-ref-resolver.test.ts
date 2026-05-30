import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const resolverPath = fileURLToPath(
  new URL("../onepassword-secret-ref-resolver.js", import.meta.url),
);
const manifestPath = fileURLToPath(new URL("../openclaw.plugin.json", import.meta.url));
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-1password-test-"));
  tempDirs.push(dir);
  return dir;
}

function runResolver(params: {
  request: unknown;
  env?: Record<string, string>;
}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        OP_SERVICE_ACCOUNT_TOKEN: "",
        OP_CONNECT_HOST: "",
        OP_CONNECT_TOKEN: "",
        OP_ACCOUNT: "",
        OP_CACHE: "",
        CLAW_1PASSWORD_OP: "",
        CLAW_1PASSWORD_VAULT: "",
        CLAW_1PASSWORD_VALUES_JSON: "",
        ...(params.env ?? {}),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ stdout, stderr, code });
    });
    child.stdin.end(`${JSON.stringify(params.request)}\n`);
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("plugin manifest", () => {
  it("declares the 1Password resolver as a managed Node SecretRef preset", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      secretProviderIntegrations?: Record<string, Record<string, unknown>>;
    };
    const integration = manifest.secretProviderIntegrations?.onepassword;

    expect(integration).toMatchObject({
      providerAlias: "onepassword",
      source: "exec",
      command: "${node}",
      args: ["./onepassword-secret-ref-resolver.js"],
    });
    expect(integration).not.toHaveProperty("trustedDirs");
  });
});

describe("1Password SecretRef resolver", () => {
  it("resolves requested ids from the inline values fallback", async () => {
    const result = await runResolver({
      request: {
        protocolVersion: 1,
        provider: "onepassword",
        ids: ["op://Engineering/OpenRouter/apiKey"],
      },
      env: {
        CLAW_1PASSWORD_VALUES_JSON: JSON.stringify({
          "op://Engineering/OpenRouter/apiKey": "not-a-real-value",
        }),
      },
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual({
      protocolVersion: 1,
      values: {
        "op://Engineering/OpenRouter/apiKey": "not-a-real-value",
      },
      errors: {},
    });
  });

  it("uses op read with native 1Password secret references", async () => {
    const tempDir = makeTempDir();
    const opPath = path.join(tempDir, "op");
    const logPath = path.join(tempDir, "op-args.json");
    fs.writeFileSync(
      opPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write("not-a-real-value\\n");
`,
      { mode: 0o755 },
    );

    const result = await runResolver({
      request: {
        protocolVersion: 1,
        provider: "onepassword",
        ids: ["op://Engineering/OpenRouter/apiKey"],
      },
      env: {
        CLAW_1PASSWORD_OP: opPath,
      },
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual({
      protocolVersion: 1,
      values: {
        "op://Engineering/OpenRouter/apiKey": "not-a-real-value",
      },
      errors: {},
    });
    expect(JSON.parse(fs.readFileSync(logPath, "utf8"))).toEqual([
      "read",
      "op://Engineering/OpenRouter/apiKey",
    ]);
  });

  it("builds op secret references from shorthand ids and a default vault", async () => {
    const tempDir = makeTempDir();
    const opPath = path.join(tempDir, "op");
    const logPath = path.join(tempDir, "op-args.json");
    fs.writeFileSync(
      opPath,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write("not-a-real-value\\n");
`,
      { mode: 0o755 },
    );

    const result = await runResolver({
      request: {
        protocolVersion: 1,
        provider: "onepassword",
        ids: ["OpenRouter/apiKey"],
      },
      env: {
        CLAW_1PASSWORD_OP: opPath,
        CLAW_1PASSWORD_VAULT: "Engineering",
      },
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual({
      protocolVersion: 1,
      values: {
        "OpenRouter/apiKey": "not-a-real-value",
      },
      errors: {},
    });
    expect(JSON.parse(fs.readFileSync(logPath, "utf8"))).toEqual([
      "read",
      "op://Engineering/OpenRouter/apiKey",
    ]);
  });

  it("returns an actionable error when the op CLI is missing", async () => {
    const result = await runResolver({
      request: {
        protocolVersion: 1,
        provider: "onepassword",
        ids: ["op://Engineering/OpenRouter/apiKey"],
      },
      env: {
        CLAW_1PASSWORD_OP: "/does/not/exist/op",
      },
    });

    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toEqual({
      protocolVersion: 1,
      values: {},
      errors: {
        "op://Engineering/OpenRouter/apiKey": {
          message: '1Password CLI "/does/not/exist/op" is not installed or is not on PATH. Install the official 1Password CLI v2, or set CLAW_1PASSWORD_OP to its absolute path.',
        },
      },
    });
  });
});
