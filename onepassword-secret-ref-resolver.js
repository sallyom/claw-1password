#!/usr/bin/env node

import { spawn } from "node:child_process";

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(input));
  });
}

function writeResponse(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function parseRequest(input) {
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.ids)) {
    throw new Error("invalid exec SecretRef request");
  }
  return {
    protocolVersion: 1,
    ids: parsed.ids.filter((id) => typeof id === "string" && id.length > 0),
  };
}

function parseInlineValues() {
  const raw = process.env.CLAW_1PASSWORD_VALUES_JSON;
  if (!raw) {
    return undefined;
  }
  const values = JSON.parse(raw);
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("CLAW_1PASSWORD_VALUES_JSON must be a JSON object");
  }
  return values;
}

function resolveFromInlineValues(ids) {
  const values = parseInlineValues();
  if (!values) {
    return undefined;
  }
  const response = { protocolVersion: 1, values: {}, errors: {} };
  for (const id of ids) {
    if (typeof values[id] === "string") {
      response.values[id] = values[id];
    } else {
      response.errors[id] = {
        message: "1Password credential id was not present in CLAW_1PASSWORD_VALUES_JSON.",
      };
    }
  }
  return response;
}

function encodeSecretReferencePart(value) {
  return encodeURIComponent(value).replace(/%2F/giu, "%2F");
}

function resolveSecretReference(id) {
  if (id.startsWith("op://")) {
    return id;
  }
  const parts = id.split("/").filter(Boolean);
  const defaultVault = process.env.CLAW_1PASSWORD_VAULT?.trim();
  if (parts.length === 2 && defaultVault) {
    const [item, field] = parts;
    return `op://${encodeSecretReferencePart(defaultVault)}/${encodeSecretReferencePart(item)}/${encodeSecretReferencePart(field)}`;
  }
  if (parts.length === 3 || parts.length === 4) {
    return `op://${parts.map(encodeSecretReferencePart).join("/")}`;
  }
  throw new Error(
    `1Password SecretRef id "${id}" must be "op://<vault>/<item>/<field>", "<vault>/<item>/<field>", "<vault>/<item>/<section>/<field>", or "<item>/<field>" with CLAW_1PASSWORD_VAULT set.`,
  );
}

function resolveOpCommand() {
  return process.env.CLAW_1PASSWORD_OP?.trim() || "op";
}

function opMissingMessage(command) {
  return `1Password CLI "${command}" is not installed or is not on PATH. Install the official 1Password CLI v2, or set CLAW_1PASSWORD_OP to its absolute path.`;
}

function runOpRead(secretReference) {
  return new Promise((resolve, reject) => {
    const opCommand = resolveOpCommand();
    const child = spawn(opCommand, ["read", secretReference], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
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
    child.on("error", (error) => {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        reject(new Error(opMissingMessage(opCommand)));
        return;
      }
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trimEnd());
        return;
      }
      reject(new Error(`op read failed (${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}

async function resolveFromOnePassword(ids) {
  const response = { protocolVersion: 1, values: {}, errors: {} };
  await Promise.all(
    ids.map(async (id) => {
      try {
        response.values[id] = await runOpRead(resolveSecretReference(id));
      } catch (error) {
        response.errors[id] = {
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return response;
}

async function main() {
  const input = await readStdin();
  const request = parseRequest(input);
  const inline = resolveFromInlineValues(request.ids);
  if (inline) {
    writeResponse(inline);
    return;
  }
  writeResponse(await resolveFromOnePassword(request.ids));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  writeResponse({
    protocolVersion: 1,
    values: {},
    errors: {
      request: { message },
    },
  });
});
