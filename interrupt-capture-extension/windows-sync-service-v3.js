const { spawn } = require("child_process");
const path = require("path");
const helper = spawn("powershell.exe", [
  "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
  "-WindowStyle", "Hidden", "-File", path.join(__dirname, "windows-topmost-helper-v3.ps1"),
  "-ParentProcessId", String(process.pid)
], { cwd: __dirname, windowsHide: true, stdio: "ignore" });
helper.on("error", error => console.warn(`Windows topmost helper failed to start: ${error.message}`));
require("./feishu-sync-service.js");
