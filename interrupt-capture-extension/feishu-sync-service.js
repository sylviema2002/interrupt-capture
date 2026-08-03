// 中断快记 / Interrupt Capture
// Copyright (c) 2026 马骁艺. Released under the MIT License.

const http = require("http");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.INTERRUPT_CAPTURE_PORT || 8766);
const TEMP_DIR = path.join(__dirname, ".sync-tmp");
const CONFIG_PATH = path.join(__dirname, "sync-config.json");
const CONFIG_EXAMPLE_PATH = path.join(__dirname, "sync-config.example.json");
const NODE_DIR = "C:\\Program Files\\nodejs";

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const message = [
      "Missing sync-config.json.",
      "Please copy sync-config.example.json to sync-config.json, then fill in your Feishu Base token and table ID.",
      `Example file: ${CONFIG_EXAMPLE_PATH}`
    ].join(" ");
    throw new Error(message);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const missing = ["baseToken", "tableId"].filter(key => !config[key]);
  if (missing.length) {
    throw new Error(`sync-config.json is missing: ${missing.join(", ")}`);
  }
  return config;
}

const config = loadConfig();
const serviceToken = String(config.serviceToken || "").trim();

if (!serviceToken || serviceToken === "CHANGE_ME_TO_A_RANDOM_LOCAL_TOKEN") {
  throw new Error("sync-config.json is missing serviceToken. Set it to a private random string before starting the sync service.");
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  const pad = number => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds())
  ].join("");
}

function runLark(args) {
  return new Promise((resolve, reject) => {
    const command = config.larkCliPath || "lark-cli";
    const isCmd = command.toLowerCase().endsWith(".cmd");
    const file = isCmd ? "cmd.exe" : command;
    const finalArgs = isCmd ? ["/c", command, ...args] : args;

    const env = { ...process.env };
    if (process.platform === "win32" && fs.existsSync(path.join(NODE_DIR, "node.exe"))) {
      env.Path = `${NODE_DIR};${env.Path || env.PATH || ""}`;
      env.PATH = env.Path;
    }

    execFile(file, finalArgs, { cwd: __dirname, windowsHide: true, env }, (error, stdout, stderr) => {
      const text = stdout || stderr || "";
      if (error) {
        const wrapped = new Error(text || error.message);
        wrapped.stdout = stdout;
        wrapped.stderr = stderr;
        reject(wrapped);
        return;
      }

      try {
        resolve(JSON.parse(text));
      } catch {
        resolve({ ok: true, raw: text });
      }
    });
  });
}

function writeJsonArg(value) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const fileName = `payload-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
  const fullPath = path.join(TEMP_DIR, fileName);
  fs.writeFileSync(fullPath, JSON.stringify(value), "utf8");
  return {
    cliArg: `@.sync-tmp/${fileName}`,
    cleanup() {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // Best-effort cleanup only.
      }
    }
  };
}

async function runLarkWithJson(argsBeforeJson, payload, argsAfterJson = []) {
  const jsonFile = writeJsonArg(payload);
  try {
    return await runLark([...argsBeforeJson, "--json", jsonFile.cliArg, ...argsAfterJson]);
  } finally {
    jsonFile.cleanup();
  }
}

function recordPayload(item, status) {
  const payload = {
    "内容": item.text || "",
    "来源标题": item.sourceTitle || "",
    "来源链接": item.sourceUrl || "",
    "状态": status,
    "记录时间": formatDate(item.createdAt),
    "插件记录ID": item.id || ""
  };

  if (status === "已完成") {
    payload["完成时间"] = formatDate(item.completedAt || new Date().toISOString());
  }

  return payload;
}

async function findRecordId(pluginRecordId) {
  if (!pluginRecordId) return "";
  const result = await runLark([
    "base",
    "+record-search",
    "--base-token",
    config.baseToken,
    "--table-id",
    config.tableId,
    "--keyword",
    pluginRecordId,
    "--search-field",
    "插件记录ID",
    "--field-id",
    "插件记录ID",
    "--limit",
    "1",
    "--as",
    "user",
    "--format",
    "json"
  ]);
  return result?.data?.record_id_list?.[0] || "";
}

async function upsertRecord(item, status) {
  const recordId = item.feishuRecordId || await findRecordId(item.id);
  const payload = recordPayload(item, status);
  const args = [
    "base",
    "+record-upsert",
    "--base-token",
    config.baseToken,
    "--table-id",
    config.tableId
  ];

  if (recordId) {
    args.push("--record-id", recordId);
  }

  const result = await runLarkWithJson(args, payload, [
    "--as",
    "user",
    "--format",
    "json"
  ]);
  const record = result?.data?.record || result?.record || result?.data;
  return { result, recordId: record?.record_id || record?.id || recordId || await findRecordId(item.id) };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function getRequestOrigin(request) {
  return request.headers.origin || "";
}

function isAllowedOrigin(origin) {
  return !origin || /^chrome-extension:\/\/[a-z]{32}$/.test(origin) || /^ms-browser-extension:\/\/[a-z]{32}$/.test(origin);
}

function hasValidToken(request) {
  return request.headers["x-interrupt-capture-token"] === serviceToken;
}

function send(response, statusCode, data, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Interrupt-Capture-Token",
    "Vary": "Origin"
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin || "null";
  }
  response.writeHead(statusCode, {
    ...headers
  });
  response.end(JSON.stringify(data));
}

const server = http.createServer(async (request, response) => {
  const origin = getRequestOrigin(request);
  if (!isAllowedOrigin(origin)) {
    send(response, 403, { ok: false, error: "Origin not allowed" }, origin);
    return;
  }

  if (request.method === "OPTIONS") {
    send(response, 204, {}, origin);
    return;
  }

  try {
    if (!hasValidToken(request)) {
      send(response, 401, { ok: false, error: "Invalid local sync token" }, origin);
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      send(response, 200, { ok: true, baseUrl: config.baseUrl || "" }, origin);
      return;
    }

    if (request.method === "POST" && request.url === "/records") {
      const body = await readBody(request);
      const created = await upsertRecord(body.item || body, "未完成");
      send(response, 200, { ok: true, recordId: created.recordId, baseUrl: config.baseUrl || "" }, origin);
      return;
    }

    if (request.method === "POST" && request.url === "/records/complete") {
      const body = await readBody(request);
      await upsertRecord(body.item || body, "已完成");
      send(response, 200, { ok: true, baseUrl: config.baseUrl || "" }, origin);
      return;
    }

    if (request.method === "POST" && request.url === "/records/status") {
      const body = await readBody(request);
      if (!body.status) {
        send(response, 400, { ok: false, error: "Missing status" }, origin);
        return;
      }
      await upsertRecord(body.item || body, body.status);
      send(response, 200, { ok: true, baseUrl: config.baseUrl || "" }, origin);
      return;
    }

    send(response, 404, { ok: false, error: "Not found" }, origin);
  } catch (error) {
    send(response, 500, {
      ok: false,
      error: error.message || String(error),
      stderr: error.stderr || "",
      stdout: error.stdout || ""
    }, origin);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Interrupt Capture sync service: http://127.0.0.1:${PORT}`);
  console.log(`Base: ${config.baseUrl || "(not set)"}`);
});
