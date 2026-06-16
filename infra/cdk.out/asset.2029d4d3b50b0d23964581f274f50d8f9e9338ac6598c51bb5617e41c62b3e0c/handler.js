import {
  manguito_config_default,
  schemaRegistry
} from "./chunk-7YFZJ6FP.js";

// dist/generated/handler.ts
import { handle } from "hono/aws-lambda";
import { createCmsApp } from "@bobbykim/manguito-cms-api";
import { createPostgresAdapter } from "@bobbykim/manguito-cms-db";
var dbAdapter = createPostgresAdapter();
await dbAdapter.connect();
var { app } = createCmsApp({
  name: manguito_config_default.name,
  registry: schemaRegistry,
  db: dbAdapter.getDb(),
  storage: manguito_config_default.storage,
  prefix: manguito_config_default.api.prefix,
  ...manguito_config_default.api.media ? { media: manguito_config_default.api.media } : {}
});
var handler = handle(app);
export {
  handler
};
