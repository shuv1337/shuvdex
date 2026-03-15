#!/usr/bin/env node

import { Effect } from "effect";
import { run } from "../dist/cli.js";

Effect.runPromise(run(process.argv)).then(
  (code) => process.exit(code),
  (err) => {
    console.error("Fatal:", err);
    process.exit(1);
  },
);
