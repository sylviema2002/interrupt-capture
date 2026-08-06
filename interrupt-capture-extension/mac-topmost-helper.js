// 中断快记 / Interrupt Capture
// Copyright (c) 2026 马骁艺. Released under the MIT License.

const { execFile } = require("child_process");

const parentProcessId = Number(process.argv[2] || 0);
const browserApplications = [
  "Google Chrome",
  "Microsoft Edge",
  "Brave Browser",
  "Vivaldi",
  "Opera"
];
const reminderTitlePrefix = "该回来了";
let permissionWarningShown = false;

function isParentAlive() {
  if (!parentProcessId) return true;
  try {
    process.kill(parentProcessId, 0);
    return true;
  } catch {
    return false;
  }
}

function buildScript() {
  return `
const browserApplications = ${JSON.stringify(browserApplications)};
const reminderTitlePrefix = ${JSON.stringify(reminderTitlePrefix)};

for (const appName of browserApplications) {
  try {
    const app = Application(appName);
    if (!app.running()) continue;
    const windows = app.windows();
    for (const win of windows) {
      let title = "";
      try {
        title = String(win.name() || "");
      } catch (_) {}
      if (title.startsWith(reminderTitlePrefix)) {
        try { win.index = 1; } catch (_) {}
        app.activate();
        break;
      }
    }
  } catch (_) {}
}
`;
}

function pinReminderWindows() {
  execFile("osascript", ["-l", "JavaScript", "-e", buildScript()], { timeout: 3000 }, error => {
    if (error && !permissionWarningShown) {
      permissionWarningShown = true;
      console.warn(`macOS reminder helper could not activate browser windows: ${error.message}`);
    }
  });
}

pinReminderWindows();
const timer = setInterval(() => {
  if (!isParentAlive()) {
    clearInterval(timer);
    process.exit(0);
  }
  pinReminderWindows();
}, 1000);
