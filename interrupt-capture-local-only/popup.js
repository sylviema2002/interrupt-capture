// 中断快记 / Interrupt Capture
// Copyright (c) 2026 马骁艺. Released under the MIT License.

const STORAGE_KEY = "interrupt-capture-local-only-items-v1";
const SETTINGS_KEY = "interrupt-capture-local-only-settings-v1";
const DEFAULT_REMIND_MINUTES = 15;
const VERSION_TYPE = "本地版";
const FEEDBACK_ISSUE_URL = "https://github.com/sylviema2002/interrupt-capture/issues/new";
const quickText = document.querySelector("#quickText");
const form = document.querySelector("#captureForm");
const itemList = document.querySelector("#itemList");
const categoryTabs = document.querySelector("#categoryTabs");
const sourceText = document.querySelector("#sourceText");
const copyOpenBtn = document.querySelector("#copyOpenBtn");
const testBtn = document.querySelector("#testBtn");
const statusText = document.querySelector("#statusText");
const settingsBtn = document.querySelector("#settingsBtn");
const settingsPanel = document.querySelector("#settingsPanel");
const defaultMinutesInput = document.querySelector("#defaultMinutes");
const saveSettingsBtn = document.querySelector("#saveSettingsBtn");
const primarySubmitBtn = document.querySelector("#primarySubmitBtn");
const exportAllBtn = document.querySelector("#exportAllBtn");
const cleanupCompletedBtn = document.querySelector("#cleanupCompletedBtn");
const feedbackBtn = document.querySelector("#feedbackBtn");
let currentSource = { title: "", url: "" };
let voiceReminderOverride = null;
let textCommandParseTimer = null;
let submissionInProgress = false;
let selectedCategory = "interrupt";

function chineseNumber(value) {
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  if (text === "半") return 30;
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === "十") return 10;
  if (text.includes("十")) {
    const [left, right] = text.split("十");
    return (left ? digits[left] : 1) * 10 + (right ? digits[right] : 0);
  }
  return digits[text] ?? Number.NaN;
}

function cleanVoiceItemText(value) {
  return String(value || "")
    .replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, "")
    .replace(/^提醒我(?:要)?/, "")
    .replace(/(?:请)?提醒(?:我)?$/, "")
    .replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, "")
    .trim();
}

function voiceHour(value, period = "") {
  let hour = chineseNumber(value);
  if (["下午", "晚上"].includes(period) && hour < 12) hour += 12;
  if (period === "中午" && hour < 11) hour += 12;
  return hour;
}

function voiceDate({ dayWord = "", month = 0, day = 0, hour, minute }) {
  const target = new Date();
  target.setSeconds(0, 0);
  if (month && day) {
    target.setMonth(month - 1, day);
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= Date.now()) target.setFullYear(target.getFullYear() + 1);
  } else {
    target.setHours(hour, minute, 0, 0);
    if (dayWord === "明天") target.setDate(target.getDate() + 1);
    if (dayWord === "后天") target.setDate(target.getDate() + 2);
    if (!dayWord && target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
  }
  return target;
}

function parseVoiceCommand(transcript) {
  const source = String(transcript || "").trim();
  const num = "(\\d{1,2}|[零〇一二两三四五六七八九十]+)";
  const min = "(半|\\d{1,2}|[零〇一二两三四五六七八九十]+)?";
  const range = source.match(new RegExp("^(?:(今天|明天|后天)|(?:(\\d{1,2})月(\\d{1,2})(?:日|号)))\\s*(早上|上午|中午|下午|晚上)?\\s*" + num + "\\s*(?:点|时|:|：)\\s*" + min + "\\s*分?\\s*(?:到|至|-)\\s*(早上|上午|中午|下午|晚上)?\\s*" + num + "\\s*(?:点|时|:|：)\\s*" + min + "\\s*分?[，,。；;\\s]*(.+)$"));
  if (range) {
    const firstPeriod = range[4] || "";
    const start = voiceDate({ dayWord: range[1] || "", month: Number(range[2] || 0), day: Number(range[3] || 0), hour: voiceHour(range[5], firstPeriod), minute: range[6] ? chineseNumber(range[6]) : 0 });
    const end = new Date(start);
    end.setHours(voiceHour(range[8], range[7] || firstPeriod), range[9] ? chineseNumber(range[9]) : 0, 0, 0);
    if (end > start && range[10].trim()) {
      const text = cleanVoiceItemText(range[10]);
      return { text, remindAt: start.toISOString(), label: formatTime(start) + "-" + formatTime(end) };
    }
  }
  const prefixRange = source.match(new RegExp("^(.+?)[，,。；;\\s]+(?:(今天|明天|后天)|(?:(\\d{1,2})月(\\d{1,2})(?:日|号)))\\s*(早上|上午|中午|下午|晚上)?\\s*" + num + "\\s*(?:点|时|:|：)\\s*" + min + "\\s*分?\\s*(?:到|至|-)\\s*(早上|上午|中午|下午|晚上)?\\s*" + num + "\\s*(?:点|时|:|：)\\s*" + min + "\\s*分?[。！？.!?]*$"));
  if (prefixRange) {
    const firstPeriod = prefixRange[5] || "";
    const start = voiceDate({ dayWord: prefixRange[2] || "", month: Number(prefixRange[3] || 0), day: Number(prefixRange[4] || 0), hour: voiceHour(prefixRange[6], firstPeriod), minute: prefixRange[7] ? chineseNumber(prefixRange[7]) : 0 });
    const end = new Date(start);
    end.setHours(voiceHour(prefixRange[9], prefixRange[8] || firstPeriod), prefixRange[10] ? chineseNumber(prefixRange[10]) : 0, 0, 0);
    const text = cleanVoiceItemText(prefixRange[1]);
    if (end > start && text) return { text, remindAt: start.toISOString(), label: formatTime(start) + "-" + formatTime(end) };
  }
  if (/(?:点|时|:|：).*?(?:到|至|-)\s*/.test(source)) {
    return { text: source, awaitingMoreText: true };
  }
  const relative = source.match(/(\d+|[零〇一二两三四五六七八九十]+)\s*(分钟|分|小时|个小时)\s*后/);
  if (relative) {
    const amount = chineseNumber(relative[1]);
    const minutes = relative[2].includes("小时") ? amount * 60 : amount;
    const text = cleanVoiceItemText(source.slice(0, relative.index) + source.slice(relative.index + relative[0].length));
    if (Number.isFinite(minutes) && minutes > 0 && minutes <= 10080) {
      return { text, reminderMinutes: minutes, remindAt: minutesFromNow(minutes), label: minutes + " 分钟后" };
    }
  }
  const dated = source.match(/(\d{1,2})月(\d{1,2})(?:日|号)\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2}|[零〇一二两三四五六七八九十]+)\s*(?:点|时|:|：)\s*(半|\d{1,2}|[零〇一二两三四五六七八九十]+)?\s*分?/);
  if (dated) {
    const target = voiceDate({ month: Number(dated[1]), day: Number(dated[2]), hour: voiceHour(dated[4], dated[3] || ""), minute: dated[5] ? chineseNumber(dated[5]) : 0 });
    return { text: cleanVoiceItemText(source.slice(0, dated.index) + source.slice(dated.index + dated[0].length)), remindAt: target.toISOString(), label: formatTime(target) };
  }
  const timeFirst = source.match(/^(今天|明天|后天)?\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2}|[零〇一二两三四五六七八九十]+)\s*(?:点|时|:|：)\s*(半|\d{1,2}|[零〇一二两三四五六七八九十]+)?\s*分?(?:提醒(?:我)?)?[，,。；;\s]*(.+)$/);
  if (timeFirst) {
    const target = voiceDate({ dayWord: timeFirst[1] || "", hour: voiceHour(timeFirst[3], timeFirst[2] || ""), minute: timeFirst[4] ? chineseNumber(timeFirst[4]) : 0 });
    return { text: cleanVoiceItemText(timeFirst[5]), remindAt: target.toISOString(), label: formatTime(target) };
  }
  const absolute = source.match(/^(.*?)[，,。；;\s]*(今天|明天|后天)?\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2}|[零〇一二两三四五六七八九十]+)\s*(?:点|时|:|：)\s*(半|\d{1,2}|[零〇一二两三四五六七八九十]+)?\s*分?(?:提醒(?:我)?)?[。！？.!?]*$/);
  if (absolute) {
    const target = voiceDate({ dayWord: absolute[2] || "", hour: voiceHour(absolute[4], absolute[3] || ""), minute: absolute[5] ? chineseNumber(absolute[5]) : 0 });
    return { text: cleanVoiceItemText(absolute[1]), remindAt: target.toISOString(), label: formatTime(target) };
  }
  return { text: source };
}

function scheduleTextCommandParse() {
  window.clearTimeout(textCommandParseTimer);
  textCommandParseTimer = window.setTimeout(() => {
    if (submissionInProgress) return;
    const rawText = quickText.value.trim();
    if (!rawText) return;
    const command = parseVoiceCommand(rawText);
    if (command.awaitingMoreText) {
      setStatus("已识别时间段，请继续说事项，例如：写汇报。", "");
      return;
    }
    if (!command.text) return;
    if (!command.remindAt) {
      const plainText = command.text;
      setStatus("未识别到时间，将按默认时间自动创建中断任务…", "");
      textCommandParseTimer = window.setTimeout(() => {
        if (submissionInProgress || quickText.value.trim() !== plainText) return;
        quickText.value = plainText;
        voiceReminderOverride = { text: plainText, label: "默认时间" };
        form.requestSubmit();
      }, 700);
      return;
    }
    quickText.value = command.text;
    voiceReminderOverride = command;
    setStatus(`已识别提醒：${command.label}，正在自动保存…`, "ok");
    form.requestSubmit();
  }, 800);
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function normalizeReminderMinutes(value) {
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes)) return DEFAULT_REMIND_MINUTES;
  return Math.min(Math.max(minutes, 1), 1440);
}

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    defaultMinutes: normalizeReminderMinutes(data[SETTINGS_KEY]?.defaultMinutes || DEFAULT_REMIND_MINUTES)
  };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

async function getDefaultReminderMinutes() {
  const settings = await loadSettings();
  return settings.defaultMinutes;
}

function reminderMinutesFor(item) {
  return normalizeReminderMinutes(item?.reminderMinutes || DEFAULT_REMIND_MINUTES);
}

function updatePrimaryButton(minutes) {
  primarySubmitBtn.textContent = `记一下，${minutes} 分钟后提醒`;
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

function setStatus(message, kind = "") {
  statusText.textContent = message;
  statusText.className = `status ${kind}`.trim();
}

function manifestVersion() {
  return chrome.runtime.getManifest().version || "未知";
}

function feedbackTemplate() {
  return [
    "问题描述：",
    "",
    "使用场景：",
    "",
    "期望表现：",
    "",
    "实际表现：",
    "",
    `插件版本：${manifestVersion()}`,
    `版本类型：${VERSION_TYPE}`,
    "浏览器："
  ].join("\n");
}

function feedbackIssueUrl() {
  if (!FEEDBACK_ISSUE_URL) return "";
  const title = encodeURIComponent("中断快记反馈：");
  const body = encodeURIComponent(feedbackTemplate());
  return `${FEEDBACK_ISSUE_URL}?title=${title}&body=${body}`;
}

async function sendMessage(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response || { ok: false, errorText: "后台没有返回结果" };
  } catch (error) {
    return { ok: false, errorText: error?.message || String(error) };
  }
}

async function loadItems() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}

async function saveItems(items) {
  await chrome.storage.local.set({ [STORAGE_KEY]: items });
}

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || {};
}

async function cancelSchedule(item) {
  await sendMessage({ type: "cancel", id: item.id });
}

function timeLeftText(value) {
  if (!value) return "未设置";
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return "应该已经提醒";
  const minutes = Math.ceil(ms / 60000);
  return `${minutes} 分钟后`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
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

async function choosePlanTime() {
  const tomorrowMorning = tomorrowAt(9);
  const defaultEnd = new Date(tomorrowMorning.getTime() + 30 * 60 * 1000);
  const result = await showWheelDialog({
    title: "选择规划时间",
    columns: [
      { id: "date", label: "日期", values: dateOptions(45), selected: `${tomorrowMorning.getFullYear()}-${pad2(tomorrowMorning.getMonth() + 1)}-${pad2(tomorrowMorning.getDate())}` },
      { id: "hour", label: "小时", values: numberOptions(0, 23, 1, " 点"), selected: tomorrowMorning.getHours() },
      { id: "minute", label: "分钟", values: numberOptions(0, 55, 5, " 分"), selected: tomorrowMorning.getMinutes() },
      { id: "endHour", label: "结束小时", values: numberOptions(0, 23, 1, " 点"), selected: defaultEnd.getHours() },
      { id: "endMinute", label: "结束分钟", values: numberOptions(0, 55, 5, " 分"), selected: defaultEnd.getMinutes() }
    ]
  });
  if (result === null) return null;
  const startDate = dateFromKey(result.date, result.hour, result.minute);
  if (!startDate || Number.isNaN(startDate.getTime())) return { error: "请选择有效的日期和时间。" };
  if (startDate.getTime() <= Date.now()) return { error: "时间已经过去，请重新选择。" };
  const endDate = dateFromKey(result.date, result.endHour, result.endMinute);
  if (!endDate || Number.isNaN(endDate.getTime())) return { error: "请选择有效的结束时间。" };
  if (endDate.getTime() <= startDate.getTime()) return { error: "结束时间要晚于开始时间。" };
  return { startAt: startDate.toISOString(), endAt: endDate.toISOString(), label: `${formatTime(startDate.toISOString())}-${formatTime(endDate.toISOString())}` };
}

async function chooseMinutesWheel({ title, description, defaultMinutes, min = 1, max = 1440 }) {
  const selected = Math.min(Math.max(normalizeReminderMinutes(defaultMinutes), min), max);
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

function formatExportTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function exportText(items) {
  if (!items.length) return "暂无中断快记记录。";
  return items.map((item, index) => {
    const status = item.done ? "已完成" : item.paused ? "暂停" : "未完成";
    const lines = [
      `${index + 1}. [${status}] ${item.text}`,
      `记录时间：${formatExportTime(item.createdAt) || "未记录"}`,
      `来源：${item.sourceTitle || item.sourceUrl || "未记录来源"}`
    ];
    if (item.completedAt) lines.push(`完成时间：${formatExportTime(item.completedAt)}`);
    return lines.join("\n");
  }).join("\n\n");
}

function unfinishedText(items) {
  const openItems = items.filter(item => !item.done);
  if (!openItems.length) return "暂无未完成中断事项。";
  return openItems.map((item, index) => `${index + 1}. ${item.text}`).join("\n");
}

async function normalizeReminders() {
  const items = await loadItems();
  let changed = false;
  for (const item of items) {
    const category = categoryFor(item);
    const before = JSON.stringify(item);
    const minutes = reminderMinutesFor(item);
    item.category = category;
    if (item.reminderMinutes !== minutes) {
      item.reminderMinutes = minutes;
      changed = true;
    }
    item.paused = category !== "interrupt";
    if (category === "inbox") item.remindAt = "";
    if (category === "planned" && item.calendarStartAt) item.remindAt = item.calendarStartAt;
    if (!item.done && category === "interrupt" && !item.remindAt) {
      item.remindAt = minutesFromNow(minutes);
      changed = true;
    }
    if (before !== JSON.stringify(item)) changed = true;
  }
  if (changed) await saveItems(items);
  await sendMessage({ type: "restore" });
}

function categoryFor(item) {
  if (["interrupt", "planned", "inbox"].includes(item?.category)) return item.category;
  if (item?.calendarStartAt) return "planned";
  return item?.paused ? "inbox" : "interrupt";
}

function itemActions(item) {
  const category = categoryFor(item);
  if (category === "inbox") return `
    <button data-action="short" type="button">设短期提醒</button>
    <button class="secondary" data-action="plan" type="button">规划时间</button>
    <button class="secondary" data-action="open" type="button">打开来源</button>
    <button class="danger" data-action="delete" type="button">删除</button>`;
  if (category === "planned") return `
    <button data-action="done" type="button">已经完成</button>
    <button class="secondary" data-action="plan" type="button">改时间</button>
    <button class="secondary" data-action="inbox" type="button">待安排</button>
    <button class="secondary" data-action="open" type="button">打开来源</button>
    <button class="danger" data-action="delete" type="button">删除</button>`;
  return `
    <button data-action="done" type="button">回来了/完成</button>
    <button class="secondary" data-action="snooze" type="button">再等 ${reminderMinutesFor(item)} 分钟</button>
    <button class="secondary" data-action="short" type="button">改时间</button>
    <button class="secondary" data-action="inbox" type="button">待安排</button>
    <button class="secondary" data-action="open" type="button">打开来源</button>
    <button class="danger" data-action="delete" type="button">删除</button>`;
}

function itemMeta(item) {
  const category = categoryFor(item);
  if (category === "inbox") return "尚未安排提醒或规划时间";
  if (category === "planned") return item.calendarStartAt ? `规划时间：${formatTime(item.calendarStartAt)}-${formatTime(item.calendarEndAt)}` : "等待设置规划时间";
  return `下次强提醒：${formatTime(item.remindAt)}（${timeLeftText(item.remindAt)}，每次 ${reminderMinutesFor(item)} 分钟）`;
}

async function render() {
  await normalizeReminders();
  const items = (await loadItems()).filter(item => !item.done);
  const sections = [
    { category: "interrupt", title: "中断任务", hint: "当天及未指定日期" },
    { category: "planned", title: "规划任务", hint: "明天、后天或具体日期" },
    { category: "inbox", title: "待安排", hint: "稍后手动分类" }
  ];
  categoryTabs.innerHTML = sections.map(section => {
    const count = items.filter(item => categoryFor(item) === section.category).length;
    return `<button type="button" data-category="${section.category}" class="category-tab ${selectedCategory === section.category ? "active" : ""}">${section.title}<span>${count}</span></button>`;
  }).join("");
  const section = sections.find(entry => entry.category === selectedCategory) || sections[0];
  const visible = items.filter(item => categoryFor(item) === section.category);
  itemList.innerHTML = visible.length ? visible.map(item => `
    <article class="item ${section.category}" data-id="${item.id}">
      <p class="text">${escapeHtml(item.text)}</p>
      <div class="meta">${escapeHtml(itemMeta(item))}</div>
      <div class="meta">${escapeHtml(item.sourceTitle || item.sourceUrl || "未记录来源")}</div>
      <div class="item-actions">${itemActions(item)}</div>
    </article>`).join("") : `<div class="empty">暂无${section.title}。<br><span>${section.hint}</span></div>`;
}

async function init() {
  const settings = await loadSettings();
  defaultMinutesInput.value = settings.defaultMinutes;
  updatePrimaryButton(settings.defaultMinutes);
  currentSource = await getCurrentTab();
  sourceText.textContent = currentSource.url
    ? `来源：${currentSource.title || currentSource.url}`
    : "没有读到当前页来源";
  quickText.focus();
  await render();
  window.setInterval(render, 30000);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (submissionInProgress) return;
  submissionInProgress = true;
  window.clearTimeout(textCommandParseTimer);
  const command = voiceReminderOverride || {};
  const text = (command.text || quickText.value).trim();
  if (!text) {
    submissionInProgress = false;
    return;
  }
  const defaultMinutes = await getDefaultReminderMinutes();
  const category = command.calendarStartAt ? "planned" : "interrupt";
  const reminderMinutes = category === "interrupt" ? normalizeReminderMinutes(command.reminderMinutes || defaultMinutes) : defaultMinutes;
  const remindAt = category === "interrupt" ? (command.remindAt || minutesFromNow(reminderMinutes)) : (command.calendarStartAt || "");
  const item = {
    id: makeId(),
    text,
    sourceTitle: currentSource.title || "",
    sourceUrl: currentSource.url || "",
    createdAt: new Date().toISOString(),
    category,
    reminderMinutes,
    remindAt,
    calendarStartAt: command.calendarStartAt || "",
    calendarEndAt: command.calendarEndAt || "",
    done: false,
    paused: category !== "interrupt",
    pausedAt: "",
    lastRemindedAt: ""
  };
  const result = await sendMessage({ type: "createItem", item });
  if (!result.ok) {
    submissionInProgress = false;
    setStatus(`保存失败：${result.errorText || "请重新加载插件后再试"}`, "bad");
    return;
  }
  quickText.value = "";
  voiceReminderOverride = null;
  submissionInProgress = false;
  updatePrimaryButton(defaultMinutes);
  selectedCategory = category;
  setStatus(category === "planned" ? `已创建规划任务，将在 ${command.label} 提醒。` : `已创建中断任务，将在 ${formatTime(remindAt)} 强提醒。`, "ok");
  await render();
});

quickText.addEventListener("input", scheduleTextCommandParse);

quickText.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    form.requestSubmit();
  }
});

copyOpenBtn.addEventListener("click", async () => {
  const items = await loadItems();
  const text = unfinishedText(items);
  await navigator.clipboard.writeText(text);
  setStatus("已复制未完成事项。", "ok");
});

categoryTabs.addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  selectedCategory = button.dataset.category;
  render();
});

settingsBtn.addEventListener("click", () => {
  settingsPanel.classList.toggle("open");
});

saveSettingsBtn.addEventListener("click", async () => {
  const minutes = normalizeReminderMinutes(defaultMinutesInput.value);
  defaultMinutesInput.value = minutes;
  await saveSettings({ defaultMinutes: minutes });
  updatePrimaryButton(minutes);
  setStatus(`已保存。之后新增事项默认 ${minutes} 分钟后提醒。`, "ok");
});

exportAllBtn.addEventListener("click", async () => {
  const result = await sendMessage({ type: "downloadTxt" });
  if (!result.ok) {
    setStatus(`导出失败：${result.errorText || "后台没有响应"}`, "bad");
    return;
  }
  setStatus("已导出全部数据。", "ok");
});

cleanupCompletedBtn.addEventListener("click", async () => {
  const ok = confirm("确定清理此刻之前所有已完成记录吗？清理后，下次导出全部数据将只包含清理之后保留和新增的数据。");
  if (!ok) return;
  const result = await sendMessage({ type: "cleanupCompleted" });
  if (!result.ok) {
    setStatus(`清理失败：${result.errorText || "后台没有响应"}`, "bad");
    return;
  }
  setStatus(`已清理 ${result.removedCount || 0} 条已完成记录。`, "ok");
  await render();
});

feedbackBtn.addEventListener("click", async () => {
  const url = feedbackIssueUrl();
  if (url) {
    await chrome.tabs.create({ url });
    setStatus("已打开反馈页面。", "ok");
    return;
  }
  await navigator.clipboard.writeText(feedbackTemplate());
  setStatus("已打开 GitHub Issue 页面。", "ok");
});

testBtn.addEventListener("click", async () => {
  setStatus("正在测试提醒...", "");
  const result = await sendMessage({ type: "test" });
  if (!result.ok) {
    setStatus(`测试失败：${result.errorText || "后台没有响应"}`, "bad");
    return;
  }
  if (!result.shown) {
    setStatus(`强提醒窗口没有弹出：${result.errorText || "原因未知"}`, "bad");
    return;
  }
  setStatus("测试已触发。之后只会弹出屏幕中间的强提醒窗口。", "ok");
});

itemList.addEventListener("click", async event => {
  const button = event.target.closest("button");
  const card = event.target.closest("[data-id]");
  if (!button || !card) return;
  const items = await loadItems();
  const item = items.find(entry => entry.id === card.dataset.id);
  if (!item) return;

  if (button.dataset.action === "done") {
    const result = await sendMessage({ type: "complete", id: item.id });
    if (!result.ok) {
      setStatus(`完成失败：${result.errorText || "后台没有响应"}`, "bad");
      return;
    }
    setStatus("已完成。列表里不再显示，但会保留在导出记录中。", "ok");
    await render();
  }

  if (button.dataset.action === "snooze") {
    button.disabled = true;
    button.textContent = "正在延后...";
    const result = await sendMessage({ type: "snooze", id: item.id });
    if (!result.ok) {
      setStatus(`延后失败：${result.errorText || "后台没有响应"}`, "bad");
      button.disabled = false;
      button.textContent = `再等 ${reminderMinutesFor(item)} 分钟`;
      return;
    }
    const remindAt = result.item?.remindAt || minutesFromNow(reminderMinutesFor(item));
    setStatus(`已延后到 ${formatTime(remindAt)}。`, "ok");
    await render();
  }

  if (button.dataset.action === "inbox") {
    const result = await sendMessage({ type: "moveToInbox", id: item.id });
    if (!result.ok) { setStatus(`移入待安排失败：${result.errorText || "后台没有响应"}`, "bad"); return; }
    selectedCategory = "inbox";
    setStatus("已移入待安排。", "ok");
    await render();
  }

  if (button.dataset.action === "short") {
    const minutes = await chooseMinutesWheel({ title: "设置短期强提醒", description: "只能设置 1–60 分钟，并按此间隔循环提醒。", defaultMinutes: reminderMinutesFor(item), min: 1, max: 60 });
    if (minutes === null) return;
    const result = await sendMessage({ type: "reschedule", id: item.id, minutes });
    if (!result.ok) { setStatus(`设置短期提醒失败：${result.errorText || "后台没有响应"}`, "bad"); return; }
    selectedCategory = "interrupt";
    setStatus(`已设为中断任务，${minutes} 分钟后强提醒。`, "ok");
    await render();
  }

  if (button.dataset.action === "plan") {
    const planTime = await choosePlanTime();
    if (!planTime) return;
    if (planTime.error) {
      setStatus(planTime.error, "bad");
      return;
    }
    const result = await sendMessage({ type: "planItem", id: item.id, startAt: planTime.startAt, endAt: planTime.endAt });
    if (!result.ok) { setStatus(`规划时间失败：${result.errorText || "后台没有响应"}`, "bad"); return; }
    selectedCategory = "planned";
    setStatus(`已规划时间：${planTime.label}。`, "ok");
    await render();
  }

  if (button.dataset.action === "open" && item.sourceUrl) {
    await chrome.tabs.create({ url: item.sourceUrl });
  }

  if (button.dataset.action === "delete") {
    const result = await sendMessage({ type: "deleteItem", id: item.id });
    if (!result.ok) {
      setStatus(`删除失败：${result.errorText || "后台没有响应"}`, "bad");
      return;
    }
    await render();
  }
});

init();
