#!/usr/bin/env node

const raw = await new Promise((resolve, reject) => {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => resolve(input));
  process.stdin.on("error", reject);
});

try {
  const request = JSON.parse(raw || "{}");
  const message = typeof request.args?.message === "string" ? request.args.message : "";
  if (!message) {
    process.stdout.write(JSON.stringify({
      payload: { error: "message is required" },
      isError: true,
    }));
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({
    payload: {
      echoed: message,
    },
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    payload: {
      error: error instanceof Error ? error.message : String(error),
    },
    isError: true,
  }));
  process.exit(0);
}
