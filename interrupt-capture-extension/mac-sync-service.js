// 中断快记 / Interrupt Capture
// Copyright (c) 2026 马骁艺. Released under the MIT License.

const { spawn } = require("child_process");
const path = require("path");

const helper = spawn(process.execPath, [
  path.join(__dirname, "mac-topmost-helper.js"),
  String(process.pid)
], { cwd: __dirname, stdio: "ignore" });

helper.on("error", error => console.warn(`macOS reminder helper failed to start: ${error.message}`));

require("./feishu-sync-service.js");
