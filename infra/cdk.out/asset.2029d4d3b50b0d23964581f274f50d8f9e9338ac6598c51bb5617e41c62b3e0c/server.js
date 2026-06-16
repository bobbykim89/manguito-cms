import {
  manguito_config_default,
  schemaRegistry
} from "./chunk-7YFZJ6FP.js";

// dist/generated/server.ts
import { createServer } from "http";
import { resolve, extname } from "path";
import { readFile, stat } from "fs/promises";
import { fileURLToPath } from "url";
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
var __dist = fileURLToPath(new URL(".", import.meta.url));
var adminDir = resolve(__dist, "admin");
var uploadsDir = resolve(__dist, "..", "uploads");
var MIME = {
  html: "text/html; charset=utf-8",
  js: "application/javascript",
  mjs: "application/javascript",
  css: "text/css",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  webp: "image/webp"
};
var API_PREFIX = "/api";
var ADMIN_PREFIX = "/admin";
var port = Number(process.env["PORT"] ?? 3e3);
createServer(async (req, res) => {
  const url = req.url ?? "/";
  const path = url.split("?")[0] ?? "/";
  if (path.startsWith(API_PREFIX) || path.startsWith("/admin/api")) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) v.forEach((vi) => headers.append(k, vi));
    }
    const body = req.method === "GET" || req.method === "HEAD" ? void 0 : req;
    const honoReq = new Request(`http://localhost:${port}${url}`, {
      method: req.method,
      headers,
      // @ts-expect-error -- Node 22 supports body as readable stream with duplex
      body,
      ...body ? { duplex: "half" } : {}
    });
    const honoRes = await app.fetch(honoReq);
    res.statusCode = honoRes.status;
    const setCookies = [];
    honoRes.headers.forEach((v, k) => {
      if (k.toLowerCase() === "set-cookie") setCookies.push(v);
      else res.setHeader(k, v);
    });
    if (setCookies.length > 0) res.setHeader("set-cookie", setCookies);
    res.end(Buffer.from(await honoRes.arrayBuffer()));
    return;
  }
  if (path.startsWith("/uploads/")) {
    const rel = path.slice("/uploads/".length).replace(/\.\./g, "");
    const filePath = resolve(uploadsDir, rel);
    if (!filePath.startsWith(uploadsDir + "/")) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }
    try {
      const data = await readFile(filePath);
      res.setHeader("Content-Type", MIME[extname(filePath).slice(1).toLowerCase()] ?? "application/octet-stream");
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
    return;
  }
  if (path.startsWith(ADMIN_PREFIX)) {
    const rel = path.slice(ADMIN_PREFIX.length) || "/";
    const candidate = resolve(adminDir, "." + rel);
    let filePath = candidate;
    try {
      const s = await stat(candidate);
      if (!s.isFile()) filePath = resolve(adminDir, "index.html");
    } catch {
      filePath = resolve(adminDir, "index.html");
    }
    try {
      const data = await readFile(filePath);
      res.setHeader("Content-Type", MIME[extname(filePath).slice(1).toLowerCase()] ?? "application/octet-stream");
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
    return;
  }
  res.statusCode = 404;
  res.end("Not found");
}).listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
