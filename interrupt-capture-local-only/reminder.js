// 中断快记 / Interrupt Capture
// Copyright (c) 2026 马骁艺. Released under the MIT License.

const DEFAULT_REMIND_MINUTES = 15;
const params = new URLSearchParams(location.search);
const id = params.get("id") || "";
const isTest = params.get("test") === "1";
const textEl = document.querySelector("#text");
const sourceEl = document.querySelector("#source");
const headingEl = document.querySelector("#heading");
const doneBtn = document.querySelector("#doneBtn");
const snoozeBtn = document.querySelector("#snoozeBtn");
const laterBtn = document.querySelector("#laterBtn");
const pauseBtn = document.querySelector("#pauseBtn");
const openBtn = document.querySelector("#openBtn");
let item = null;
let keepOnTopTimer = null;

function closeSoon() {
  window.setTimeout(() => window.close(), 250);
}

function reminderMinutesFor(value) {
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes)) return DEFAULT_REMIND_MINUTES;
  return Math.min(Math.max(minutes, 1), 1440);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateTimeForInput(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseDateTimeInput(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) return null;
  if (date.getTime() <= Date.now()) return null;
  return date;
}

function tomorrowAt(hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function chooseLaterReminder(currentMinutes) {
  const tomorrowMorning = tomorrowAt(9);
  const defaultCustom = formatDateTimeForInput(tomorrowMorning);
  const choice = prompt(
    [
      "稍后什么时候提醒？",
      "1. 15 分钟后",
      "2. 1 小时后",
      "3. 明天 9:00",
      "4. 自定义分钟后",
      "5. 自定义日期时间",
      "",
      "输入 1-5"
    ].join("\n"),
    "1"
  );
  if (choice === null) return null;
  const trimmed = choice.trim();
  if (trimmed === "1") return { minutes: 15, label: "15 分钟后" };
  if (trimmed === "2") return { minutes: 60, label: "1 小时后" };
  if (trimmed === "3") return { remindAt: tomorrowMorning.toISOString(), label: `明天 ${pad2(tomorrowMorning.getHours())}:00` };
  if (trimmed === "4") {
    const input = prompt("多少分钟后提醒？", String(currentMinutes || DEFAULT_REMIND_MINUTES));
    if (input === null) return null;
    const minutes = reminderMinutesFor(input);
    return { minutes, label: `${minutes} 分钟后` };
  }
  if (trimmed === "5") {
    const input = prompt("输入提醒时间，格式：YYYY-MM-DD HH:mm", defaultCustom);
    if (input === null) return null;
    const date = parseDateTimeInput(input);
    if (!date) return { error: "时间格式不对，或时间已经过去。请用 YYYY-MM-DD HH:mm。" };
    return { remindAt: date.toISOString(), label: formatTime(date.toISOString()) };
  }
  return { error: "请输入 1-5 之间的数字。" };
}

async function sendMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, errorText: error?.message || String(error) };
  }
}

function render() {
  if (isTest) {
    headingEl.textContent = "测试提醒";
    textEl.textContent = params.get("text") || "如果你看到这个窗口，说明强提醒可用。";
    sourceEl.textContent = "这是屏幕中间的强提醒窗口。";
    doneBtn.textContent = "知道了";
    snoozeBtn.style.display = "none";
    laterBtn.style.display = "none";
    pauseBtn.style.display = "none";
    openBtn.style.display = "none";
    return;
  }

  if (!item) {
    headingEl.textContent = "提醒已不存在";
    textEl.textContent = "这条中断事项可能已经完成或删除。";
    sourceEl.textContent = "";
    doneBtn.textContent = "关闭";
    snoozeBtn.style.display = "none";
    laterBtn.style.display = "none";
    pauseBtn.style.display = "none";
    openBtn.style.display = "none";
    return;
  }

  headingEl.textContent = "该回来了";
  textEl.textContent = item.text || "未命名事项";
  sourceEl.textContent = item.sourceTitle || item.sourceUrl || "没有记录来源";
  snoozeBtn.textContent = `再等 ${reminderMinutesFor(item.reminderMinutes)} 分钟`;
  openBtn.style.display = item.sourceUrl ? "" : "none";
}

async function init() {
  if (!isTest && id) {
    const response = await sendMessage({ type: "getItem", id });
    item = response?.item || null;
  }
  render();
  startKeepOnTop();
}

function startKeepOnTop() {
  if (keepOnTopTimer) return;
  sendMessage({ type: "keepReminderOnTop", id });
  keepOnTopTimer = window.setInterval(() => {
    sendMessage({ type: "keepReminderOnTop", id });
    window.focus();
  }, 4000);
}

doneBtn.addEventListener("click", async () => {
  if (!isTest && id) {
    const result = await sendMessage({ type: "complete", id });
    if (!result?.ok) {
      headingEl.textContent = "操作失败";
      textEl.textContent = result?.errorText || "后台没有响应，请重新加载插件后再试。";
      sourceEl.textContent = "这条记录仍会留在本地继续提醒。";
      return;
    }
  }
  closeSoon();
});

snoozeBtn.addEventListener("click", async () => {
  let minutes = reminderMinutesFor(item?.reminderMinutes);
  if (!isTest && id) {
    const result = await sendMessage({ type: "snooze", id });
    if (!result?.ok) {
      headingEl.textContent = "延后失败";
      textEl.textContent = result?.errorText || "后台没有响应。";
      sourceEl.textContent = "这条记录仍会留在本地继续提醒。";
      return;
    }
    minutes = reminderMinutesFor(result.item?.reminderMinutes || minutes);
  }
  headingEl.textContent = "已延后";
  textEl.textContent = `${minutes} 分钟后会再次提醒。`;
  sourceEl.textContent = "";
  closeSoon();
});

laterBtn.addEventListener("click", async () => {
  if (isTest || !id) return;
  const later = chooseLaterReminder(reminderMinutesFor(item?.reminderMinutes));
  if (!later) return;
  if (later.error) {
    headingEl.textContent = "稍后提醒失败";
    textEl.textContent = later.error;
    sourceEl.textContent = "";
    return;
  }
  const result = await sendMessage({ type: "reschedule", id, ...later });
  if (!result?.ok) {
    headingEl.textContent = "稍后提醒失败";
    textEl.textContent = result?.errorText || "后台没有响应。";
    sourceEl.textContent = "这条记录仍会留在本地继续提醒。";
    return;
  }
  const remindAt = result.item?.remindAt || later.remindAt;
  headingEl.textContent = "已安排稍后提醒";
  textEl.textContent = `${later.label}提醒：${formatTime(remindAt)}。`;
  sourceEl.textContent = "";
  closeSoon();
});

pauseBtn.addEventListener("click", async () => {
  if (!isTest && id) {
    const result = await sendMessage({ type: "pause", id });
    if (!result?.ok) {
      headingEl.textContent = "暂停失败";
      textEl.textContent = result?.errorText || "后台没有响应，请重新加载插件后再试。";
      sourceEl.textContent = "这条记录仍会留在本地继续提醒。";
      return;
    }
  }
  headingEl.textContent = "已暂停";
  textEl.textContent = "这件事不会继续提醒，之后可在插件列表里恢复计时。";
  sourceEl.textContent = "";
  closeSoon();
});

openBtn.addEventListener("click", async () => {
  if (!isTest && id) await sendMessage({ type: "openSource", id });
});

init();
