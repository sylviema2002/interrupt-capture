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


function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function closeDialog(backdrop, value, resolve) {
  backdrop.remove();
  resolve(value);
}

function showChoiceDialog({ title, description = "", options = [] }) {
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    const buttons = options.map(option => `
      <button class="dialog-option" data-value="${escapeHtml(option.value)}" type="button">${escapeHtml(option.label)}</button>
    `).join("");
    backdrop.innerHTML = `
      <section class="dialog" role="dialog" aria-modal="true">
        <h2>${escapeHtml(title)}</h2>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        <div class="dialog-options">${buttons}</div>
        <div class="dialog-actions">
          <button class="secondary" data-action="cancel" type="button">取消</button>
        </div>
      </section>
    `;
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop || event.target.dataset.action === "cancel") {
        closeDialog(backdrop, null, resolve);
        return;
      }
      const button = event.target.closest("[data-value]");
      if (button) closeDialog(backdrop, button.dataset.value, resolve);
    });
  });
}

function showInputDialog({ title, description = "", defaultValue = "", inputMode = "text" }) {
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `
      <section class="dialog" role="dialog" aria-modal="true">
        <h2>${escapeHtml(title)}</h2>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        <input id="dialogInput" type="text" inputmode="${escapeHtml(inputMode)}" value="${escapeHtml(defaultValue)}">
        <div class="dialog-actions">
          <button data-action="ok" type="button">确定</button>
          <button class="secondary" data-action="cancel" type="button">取消</button>
        </div>
      </section>
    `;
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector("#dialogInput");
    input.focus();
    input.select();
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop || event.target.dataset.action === "cancel") {
        closeDialog(backdrop, null, resolve);
      }
      if (event.target.dataset.action === "ok") {
        closeDialog(backdrop, input.value, resolve);
      }
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") closeDialog(backdrop, input.value, resolve);
      if (event.key === "Escape") closeDialog(backdrop, null, resolve);
    });
  });
}

function showWheelDialog({ title, description = "", columns = [] }) {
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    const dateColumn = columns.find(column => column.id === "date");
    const hourColumn = columns.find(column => column.id === "hour");
    const minuteColumn = columns.find(column => column.id === "minute");
    const otherColumns = columns.filter(column => !["date", "hour", "minute"].includes(column.id));
    const selectedDate = String(dateColumn?.selected || "");
    const selectedHour = pad2(hourColumn?.selected ?? 9);
    const selectedMinute = pad2(minuteColumn?.selected ?? 0);
    const dateTimeRow = dateColumn && hourColumn && minuteColumn ? `
      <div class="schedule-row" aria-label="选择日期和时间">
        <span class="schedule-icon" aria-hidden="true">◷</span>
        <input class="schedule-date" id="dialogDate" type="date" value="${escapeHtml(selectedDate)}">
        <input class="schedule-time" id="dialogTime" type="time" step="300" value="${escapeHtml(`${selectedHour}:${selectedMinute}`)}">
      </div>
    ` : "";
    const selectRows = otherColumns.map(column => {
      const options = column.values.map(option => `
        <option value="${escapeHtml(option.value)}" ${String(option.value) === String(column.selected) ? "selected" : ""}>${escapeHtml(option.label)}</option>
      `).join("");
      return `
        <label class="schedule-select-row">
          <span>${escapeHtml(column.label)}</span>
          <select data-schedule-id="${escapeHtml(column.id)}">${options}</select>
        </label>
      `;
    }).join("");
    backdrop.innerHTML = `
      <section class="dialog" role="dialog" aria-modal="true">
        <h2>${escapeHtml(title)}</h2>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        <div class="schedule-form">${dateTimeRow}${selectRows}</div>
        <div class="dialog-actions">
          <button data-action="ok" type="button">确定</button>
          <button class="secondary" data-action="cancel" type="button">取消</button>
        </div>
      </section>
    `;
    document.body.appendChild(backdrop);
    const firstInput = backdrop.querySelector("input, select");
    firstInput?.focus();
    const collectValue = () => {
      const value = {};
      const dateInput = backdrop.querySelector("#dialogDate");
      const timeInput = backdrop.querySelector("#dialogTime");
      if (dateInput) value.date = dateInput.value;
      if (timeInput) {
        const [hour = "0", minute = "0"] = timeInput.value.split(":");
        value.hour = hour;
        value.minute = minute;
      }
      for (const select of backdrop.querySelectorAll("select[data-schedule-id]")) {
        value[select.dataset.scheduleId] = select.value;
      }
      return value;
    };
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop || event.target.dataset.action === "cancel") {
        closeDialog(backdrop, null, resolve);
      }
      if (event.target.dataset.action === "ok") {
        closeDialog(backdrop, collectValue(), resolve);
      }
    });
    backdrop.addEventListener("keydown", event => {
      if (event.key === "Escape") closeDialog(backdrop, null, resolve);
      if (event.key === "Enter") closeDialog(backdrop, collectValue(), resolve);
    });
  });
}

function numberOptions(min, max, step = 1, suffix = "") {
  const values = [];
  for (let value = min; value <= max; value += step) {
    values.push({ value: String(value), label: `${value}${suffix}` });
  }
  return values;
}

function dateOptions(days = 30) {
  const values = [];
  const today = new Date();
  for (let index = 0; index < days; index += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    date.setHours(0, 0, 0, 0);
    const key = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    let prefix = `${date.getMonth() + 1}/${date.getDate()}`;
    if (index === 0) prefix = "今天";
    if (index === 1) prefix = "明天";
    values.push({ value: key, label: `${prefix} 周${"日一二三四五六"[date.getDay()]}` });
  }
  return values;
}

function dateFromKey(key, hour, minute) {
  const [year, month, day] = String(key || "").split(/[-/]/).map(value => Number.parseInt(value, 10));
  const parsedHour = Number.parseInt(hour, 10);
  const parsedMinute = Number.parseInt(minute, 10);
  if (![year, month, day, parsedHour, parsedMinute].every(Number.isFinite)) return null;
  if (parsedHour < 0 || parsedHour > 23 || parsedMinute < 0 || parsedMinute > 59) return null;
  const date = new Date(year, month - 1, day, parsedHour, parsedMinute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

async function chooseMinutesWheel({ title, description, defaultMinutes, min = 1, max = 1440 }) {
  const selected = Math.min(Math.max(reminderMinutesFor(defaultMinutes), min), max);
  const input = await showInputDialog({
    title,
    description,
    defaultValue: String(selected),
    inputMode: "numeric"
  });
  if (input === null) return null;
  const minutes = Number.parseInt(input, 10);
  if (!Number.isFinite(minutes)) return min;
  return Math.min(Math.max(minutes, min), max);
}

async function chooseDateTimeWheel({ title, description, defaultDate }) {
  const fallback = defaultDate || tomorrowAt(9);
  const result = await showWheelDialog({
    title,
    description,
    columns: [
      { id: "date", label: "日期", values: dateOptions(45), selected: `${fallback.getFullYear()}-${pad2(fallback.getMonth() + 1)}-${pad2(fallback.getDate())}` },
      { id: "hour", label: "小时", values: numberOptions(0, 23, 1, " 点"), selected: fallback.getHours() },
      { id: "minute", label: "分钟", values: numberOptions(0, 55, 5, " 分"), selected: Math.min(55, Math.round(fallback.getMinutes() / 5) * 5) }
    ]
  });
  if (result === null) return null;
  const date = dateFromKey(result.date, result.hour, result.minute);
  if (!date || Number.isNaN(date.getTime())) return { error: "请选择有效的日期和时间。" };
  if (date.getTime() <= Date.now()) return { error: "时间已经过去，请重新选择。" };
  return { date };
}

function tomorrowAt(hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function chooseLaterReminder(currentMinutes) {
  const tomorrowMorning = tomorrowAt(9);
  const trimmed = await showChoiceDialog({
    title: "稍后什么时候提醒？",
    options: [
      { value: "1", label: "15 分钟后" },
      { value: "2", label: "1 小时后" },
      { value: "3", label: "明天 9:00" },
      { value: "4", label: "自定义分钟" },
      { value: "5", label: "自定义时间" }
    ]
  });
  if (trimmed === null) return null;
  if (trimmed === "1") return { minutes: 15, label: "15 分钟后" };
  if (trimmed === "2") return { minutes: 60, label: "1 小时后" };
  if (trimmed === "3") return { remindAt: tomorrowMorning.toISOString(), label: `明天 ${pad2(tomorrowMorning.getHours())}:00` };
  if (trimmed === "4") {
    const minutes = await chooseMinutesWheel({
      title: "选择提醒间隔",
      defaultMinutes: currentMinutes || DEFAULT_REMIND_MINUTES
    });
    if (minutes === null) return null;
    return { minutes, label: `${minutes} 分钟后` };
  }
  if (trimmed === "5") {
    const result = await chooseDateTimeWheel({
      title: "选择提醒时间",
      defaultDate: tomorrowMorning
    });
    if (result === null) return null;
    if (result.error) return result;
    return { remindAt: result.date.toISOString(), label: formatTime(result.date.toISOString()) };
  }
  return { error: "请选择一个提醒时间。" };
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

  headingEl.textContent = item.category === "planned" ? "开始完成这项任务" : "该回来了";
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
  const later = await chooseLaterReminder(reminderMinutesFor(item?.reminderMinutes));
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
  textEl.textContent = "已移入待安排，之后可在插件列表里重新设置提醒或规划时间。";
  sourceEl.textContent = "";
  closeSoon();
});

openBtn.addEventListener("click", async () => {
  if (!isTest && id) await sendMessage({ type: "openSource", id });
});

init();
