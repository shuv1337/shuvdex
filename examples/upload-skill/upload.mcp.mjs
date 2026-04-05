#!/usr/bin/env node
/**
 * Upload tool — reads JSON from stdin, uploads file to files.shuv.me via SCP,
 * writes JSON result to stdout.
 *
 * Input contract (via request.args):
 *   { contentBase64: string, filename: string }  — upload raw base64 content
 *   { sourceUrl: string, filename: string }       — download URL then upload
 *
 * Output: { url, filename, bytes, durationMs }
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const VPS_HOST = "vps";
const UPLOAD_DIR = "/home/shuv/repos/ltc-files/data/upload";
const PUBLIC_BASE = "https://files.shuv.me";

function fail(message) {
  process.stdout.write(JSON.stringify({
    payload: { error: message, capability: "skill.upload.file" },
    isError: true,
  }));
  process.exit(0);
}

const raw = await new Promise((resolve, reject) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => resolve(input));
  process.stdin.on("error", reject);
});

try {
  const startMs = Date.now();
  const request = JSON.parse(raw || "{}");
  const args = request.args ?? {};
  const { contentBase64, sourceUrl, filename } = args;

  if (!filename || typeof filename !== "string") {
    fail("filename is required");
  }

  // Sanitize filename — no path traversal
  const safeName = path.basename(filename);
  if (safeName !== filename || filename.includes("..")) {
    fail("Invalid filename — must be a plain filename, no paths");
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shuvdex-upload-"));
  const tmpFile = path.join(tmpDir, safeName);

  try {
    if (contentBase64 && typeof contentBase64 === "string") {
      const buf = Buffer.from(contentBase64, "base64");
      if (buf.length > MAX_BYTES) {
        fail(`File too large: ${buf.length} bytes (max ${MAX_BYTES})`);
      }
      fs.writeFileSync(tmpFile, buf);
    } else if (sourceUrl && typeof sourceUrl === "string") {
      // Download URL to temp file
      execSync(`curl -fsSL -o ${JSON.stringify(tmpFile)} --max-filesize ${MAX_BYTES} ${JSON.stringify(sourceUrl)}`, {
        timeout: 20000,
      });
    } else {
      fail("Provide either contentBase64 or sourceUrl");
    }

    const bytes = fs.statSync(tmpFile).size;

    // Upload via SCP
    execSync(`scp -q ${JSON.stringify(tmpFile)} ${VPS_HOST}:${UPLOAD_DIR}/${safeName}`, {
      timeout: 20000,
    });

    const durationMs = Date.now() - startMs;
    process.stdout.write(JSON.stringify({
      payload: {
        url: `${PUBLIC_BASE}/${safeName}`,
        filename: safeName,
        bytes,
        durationMs,
        capability: "skill.upload.file",
      },
    }));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
} catch (error) {
  process.stdout.write(JSON.stringify({
    payload: {
      error: error instanceof Error ? error.message : String(error),
      capability: "skill.upload.file",
    },
    isError: true,
  }));
  process.exit(0);
}
