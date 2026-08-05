// 中断快记 / Interrupt Capture
// Copyright (c) 2026 马骁艺. Released under the MIT License.

const http = require("http");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.INTERRUPT_CAPTURE_PORT || 8766);
const SERVICE_VERSION = "0.8.4";
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
let scheduleFieldsReady = false;

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

function formatIsoLocal(value) {
  const date = value ? new Date(value) : new Date();
  const pad = number => String(number).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
    sign,
    pad(Math.floor(absOffset / 60)),
    ":",
    pad(absOffset % 60)
  ].join("");
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function cleanCliText(value) {
  return String(value || "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function resolveLarkCommand() {
  const command = config.larkCliPath || "lark-cli";
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    const cliScript = path.join(path.dirname(command), "node_modules", "@larksuite", "cli", "scripts", "run.js");
    const nodePath = path.join(NODE_DIR, "node.exe");
    if (fs.existsSync(cliScript) && fs.existsSync(nodePath)) {
      return { file: nodePath, argsPrefix: [cliScript] };
    }
    return { file: "cmd.exe", argsPrefix: ["/c", command] };
  }
  return { file: command, argsPrefix: [] };
}

function runLark(args) {
  return new Promise((resolve, reject) => {
    const command = resolveLarkCommand();
    const finalArgs = [...command.argsPrefix, ...args];

    const env = { ...process.env };
    if (process.platform === "win32" && fs.existsSync(path.join(NODE_DIR, "node.exe"))) {
      env.Path = `${NODE_DIR};${env.Path || env.PATH || ""}`;
      env.PATH = env.Path;
    }

    execFile(command.file, finalArgs, { cwd: __dirname, windowsHide: true, env }, (error, stdout, stderr) => {
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

  if (item.calendarStartAt) {
    payload["日程开始时间"] = formatDate(item.calendarStartAt);
  }

  if (item.calendarEndAt) {
    payload["日程结束时间"] = formatDate(item.calendarEndAt);
  }

  if (item.calendarStatus) {
    payload["日程状态"] = item.calendarStatus;
  }

  return payload;
}

function extractCalendarEventId(result) {
  return result?.data?.event?.event_id
    || result?.data?.event_id
    || result?.event?.event_id
    || result?.event_id
    || "";
}

function eventStartTimestamp(event) {
  return Number(event?.start_time?.timestamp || event?.start?.timestamp || event?.start || 0);
}

function eventEndTimestamp(event) {
  return Number(event?.end_time?.timestamp || event?.end?.timestamp || event?.end || 0);
}

async function ensureScheduleFields(payload) {
  if (scheduleFieldsReady || !("日程开始时间" in payload || "日程结束时间" in payload || "日程状态" in payload)) {
    return;
  }

  const result = await runLark([
    "base",
    "+field-list",
    "--base-token",
    config.baseToken,
    "--table-id",
    config.tableId,
    "--as",
    "user",
    "--format",
    "json"
  ]);
  const fields = result?.data?.fields || [];
  const existingNames = new Set(fields.map(field => field.name));
  const missingFields = [
    { name: "日程开始时间", type: "datetime", style: { format: "yyyy-MM-dd HH:mm" } },
    { name: "日程结束时间", type: "datetime", style: { format: "yyyy-MM-dd HH:mm" } },
    { name: "日程状态", type: "text" }
  ].filter(field => !existingNames.has(field.name));

  for (const field of missingFields) {
    await runLarkWithJson([
      "base",
      "+field-create",
      "--base-token",
      config.baseToken,
      "--table-id",
      config.tableId
    ], field, [
      "--as",
      "user",
      "--format",
      "json"
    ]);
  }

  scheduleFieldsReady = true;
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
  await ensureScheduleFields(payload);
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

async function createCalendarEvent(item, startAt, endAt) {
  if (!startAt || !endAt) {
    throw new Error("Missing calendar startAt or endAt.");
  }

  const cleanItem = {
    id: cleanCliText(item.id),
    text: cleanCliText(item.text),
    sourceTitle: cleanCliText(item.sourceTitle),
    sourceUrl: cleanCliText(item.sourceUrl)
  };
  const detailLines = [
    `回来先做：${cleanItem.text || ""}`,
    cleanItem.sourceTitle ? `来源标题：${cleanItem.sourceTitle}` : "",
    cleanItem.sourceUrl ? `来源链接：${cleanItem.sourceUrl}` : "",
    `中断记录ID：${cleanItem.id || ""}`
  ].filter(Boolean);
  const description = detailLines.join("\n");

  const result = await runLark([
    "calendar",
    "+create",
    "--summary",
    truncateText(cleanItem.text, 48) || "待处理事项",
    "--description",
    description,
    "--start",
    formatIsoLocal(startAt),
    "--end",
    formatIsoLocal(endAt),
    "--as",
    "user",
    "--format",
    "json"
  ]);

  return { result, eventId: extractCalendarEventId(result), calendarId: "primary" };
}

async function findCalendarEventId(item) {
  if (item.calendarEventId) return item.calendarEventId;
  if (!item.calendarStartAt || !item.calendarEndAt) return "";

  const result = await runLark([
    "calendar",
    "+search-event",
    "--calendar-id",
    item.calendarId || "primary",
    "--query",
    truncateText(cleanCliText(item.text), 48) || "待处理事项",
    "--start",
    formatIsoLocal(item.calendarStartAt),
    "--end",
    formatIsoLocal(item.calendarEndAt),
    "--page-size",
    "10",
    "--as",
    "user",
    "--format",
    "json"
  ]);
  const events = result?.data?.items || result?.data?.events || result?.items || [];
  const startSecond = Math.floor(new Date(item.calendarStartAt).getTime() / 1000);
  const endSecond = Math.floor(new Date(item.calendarEndAt).getTime() / 1000);
  const matched = events.find(event => {
    const title = event.summary || event.title || "";
    const id = event.event_id || event.id || "";
    const start = eventStartTimestamp(event);
    const end = eventEndTimestamp(event);
    const titleMatches = title.includes(cleanCliText(item.text)) || cleanCliText(item.text).includes(title);
    const timeMatches = Math.abs(start - startSecond) <= 60 && Math.abs(end - endSecond) <= 60;
    return id && (timeMatches || titleMatches);
  });
  return matched?.event_id || matched?.id || "";
}

async function deleteCalendarEvent(item) {
  const eventId = await findCalendarEventId(item || {});
  if (!eventId) {
    return { skipped: true, reason: "Missing calendar event id." };
  }
  const result = await runLark([
    "calendar",
    "events",
    "delete",
    "--calendar-id",
    item.calendarId || "primary",
    "--event-id",
    eventId,
    "--need-notification",
    "false",
    "--as",
    "user",
    "--format",
    "json"
  ]);

  return { result, eventId };
}

async function checkCalendarEvent(item) {
  if (!item?.calendarEventId) {
    return { exists: null, skipped: true, reason: "Missing calendar event id." };
  }

  const result = await runLark([
    "calendar",
    "+get",
    "--calendar-id",
    item.calendarId || "primary",
    "--event-id",
    item.calendarEventId,
    "--as",
    "user",
    "--format",
    "json"
  ]);
  const status = result?.data?.status || "";
  return {
    exists: status !== "cancelled",
    status,
    eventId: item.calendarEventId,
    result
  };
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
      send(response, 200, {
        ok: true,
        baseUrl: config.baseUrl || "",
        serviceVersion: SERVICE_VERSION,
        features: { calendarEvents: true, calendarEventDelete: true, calendarEventCheck: true }
      }, origin);
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

    if (request.method === "POST" && request.url === "/calendar-events") {
      const body = await readBody(request);
      const event = await createCalendarEvent(body.item || {}, body.startAt, body.endAt);
      send(response, 200, { ok: true, event, baseUrl: config.baseUrl || "" }, origin);
      return;
    }

    if (request.method === "POST" && request.url === "/calendar-events/delete") {
      const body = await readBody(request);
      const event = await deleteCalendarEvent(body.item || body);
      send(response, 200, { ok: true, event, baseUrl: config.baseUrl || "" }, origin);
      return;
    }

    if (request.method === "POST" && request.url === "/calendar-events/check") {
      const body = await readBody(request);
      const event = await checkCalendarEvent(body.item || body);
      send(response, 200, { ok: true, event, baseUrl: config.baseUrl || "" }, origin);
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
