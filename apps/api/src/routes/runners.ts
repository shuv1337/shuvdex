import { Hono } from "hono";

export function runnersRouter(): Hono {
  const app = new Hono();

  app.get("/", (c) =>
    c.json({
      runners: [],
      message: "Host runner transport is not implemented yet; capabilities can still declare host_runner bindings.",
    }),
  );

  return app;
}
