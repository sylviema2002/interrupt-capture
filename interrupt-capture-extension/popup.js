// 中断快记 / Interrupt Capture
// Copyright (c) 2026 马骁艺. Released under the MIT License.

const STORAGE_KEY = "interrupt-capture-extension-items-v1";
const SETTINGS_KEY = "interrupt-capture-extension-settings-v1";
const DEFAULT_REMIND_MINUTES = 15;
const VERSION_TYPE = "飞书同步版";
const FEEDBACK_ISSUE_URL = "";
const quickText = document.querySelector("#quickText");
const form = document.querySelector("#captureForm");
const itemList = document.querySelector("#itemList");
const sourceText = document.querySelector("#sourceText");
const copyOpenBtn = document.querySelector("#copyOpenBtn");
const testBtn = document.querySelector("#testBtn");
const statusText = document.querySelector("#statusText");
const settingsBtn = document.querySelector("#settingsBtn");
const settingsPanel = document.querySelector("#settingsPanel");
const defaultMinutesInput = document.querySelector("#defaultMinutes");
const saveSettingsBtn = document.querySelector("#saveSettingsBtn");
const primarySubmitBtn = document.querySelector("#primarySubmitBtn");
const feedbackBtn = document.querySelector("#feedbackBtn");
let currentSource = { title: "", url: "" };

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
    const minutes = normalizeReminderMinutes(input);
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

async function normalizeReminders() {
  const items = await loadItems();
  let changed = false;
  for (const item of items) {
    const minutes = reminderMinutesFor(item);
    if (item.reminderMinutes !== minutes) {
      item.reminderMinutes = minutes;
      changed = true;
    }
    if (!item.done && !item.paused && !item.remindAt) {
      item.remindAt = minutesFromNow(minutes);
      changed = true;
    }
  }
  if (changed) await saveItems(items);
  await sendMessage({ type: "restore" });
}

function itemActions(item) {
  if (item.paused) {
    return `
      <button data-action="resume" type="button">恢复计时</button>
      <button class="secondary" data-action="open" type="button">打开来源</button>
      <button class="danger" data-action="delete" type="button">删除</button>
    `;
  }

  return `
    <button data-action="done" type="button">回来了/完成</button>
    <button class="secondary" data-action="snooze" type="button">再等 ${reminderMinutesFor(item)} 分钟</button>
    <button class="secondary" data-action="later" type="button">稍后提醒</button>
    <button class="secondary" data-action="pause" type="button">暂停</button>
    <button class="secondary" data-action="open" type="button">打开来源</button>
    <button class="danger" data-action="delete" type="button">删除</button>
  `;
}

function itemMeta(item) {
  if (item.paused) {
    return `已暂停，不会提醒；恢复后按 ${reminderMinutesFor(item)} 分钟提醒`;
  }
  return `下次提醒：${formatTime(item.remindAt)}（${timeLeftText(item.remindAt)}，每次 ${reminderMinutesFor(item)} 分钟）`;
}

async function render() {
  await normalizeReminders();
  const items = await loadItems();
  const activeItems = items.filter(item => !item.done && !item.paused);
  const pausedItems = items.filter(item => !item.done && item.paused);
  const visibleItems = [...activeItems, ...pausedItems];
  if (!visibleItems.length) {
    itemList.innerHTML = '<div class="empty">没有未完成中断事项。</div>';
    return;
  }

  itemList.innerHTML = visibleItems.map(item => `
    <article class="item ${item.paused ? "paused" : ""}" data-id="${item.id}">
      <p class="text">${escapeHtml(item.text)}</p>
      <div class="meta">${escapeHtml(itemMeta(item))}</div>
      <div class="meta">${escapeHtml(item.sourceTitle || item.sourceUrl || "未记录来源")}</div>
      <div class="item-actions">
        ${itemActions(item)}
      </div>
    </article>
  `).join("");
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
  const text = quickText.value.trim();
  if (!text) return;
  const defaultMinutes = await getDefaultReminderMinutes();
  const item = {
    id: makeId(),
    text,
    sourceTitle: currentSource.title || "",
    sourceUrl: currentSource.url || "",
    createdAt: new Date().toISOString(),
    reminderMinutes: defaultMinutes,
    remindAt: minutesFromNow(defaultMinutes),
    done: false,
    paused: false,
    pausedAt: "",
    lastRemindedAt: ""
  };
  setStatus("正在写入飞书...", "");
  const result = await sendMessage({ type: "createItem", item });
  if (!result.ok) {
    setStatus(`写入飞书失败：${result.errorText || "请确认本机同步服务已启动"}`, "bad");
    return;
  }
  quickText.value = "";
  setStatus("已写入飞书，并加入本地提醒。", "ok");
  await render();
});

quickText.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    form.requestSubmit();
  }
});

copyOpenBtn.addEventListener("click", async () => {
  const items = await loadItems();
  const text = items
    .filter(item => !item.done)
    .map((item, index) => `${index + 1}. ${item.text}`)
    .join("\n") || "暂无未完成中断事项。";
  try {
    await navigator.clipboard.writeText(text);
    setStatus("已复制未完成事项。", "ok");
  } catch (error) {
    setStatus(`复制失败：${error?.message || String(error)}`, "bad");
  }
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

feedbackBtn.addEventListener("click", async () => {
  const url = feedbackIssueUrl();
  if (url) {
    await chrome.tabs.create({ url });
    setStatus("已打开反馈页面。", "ok");
    return;
  }
  await navigator.clipboard.writeText(feedbackTemplate());
  setStatus("已复制反馈模板。GitHub 地址配置好后，这个按钮会直接打开 Issue 页面。", "ok");
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
      setStatus(`更新飞书失败：${result.errorText || "请确认本机同步服务已启动"}`, "bad");
      return;
    }
    setStatus("已更新飞书，并从本地删除。", "ok");
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

  if (button.dataset.action === "later") {
    const currentMinutes = reminderMinutesFor(item);
    const later = chooseLaterReminder(currentMinutes);
    if (!later) return;
    if (later.error) {
      setStatus(later.error, "bad");
      return;
    }
    const result = await sendMessage({ type: "reschedule", id: item.id, ...later });
    if (!result.ok) {
      setStatus(`稍后提醒失败：${result.errorText || "后台没有响应"}`, "bad");
      return;
    }
    const remindAt = result.item?.remindAt || later.remindAt || minutesFromNow(later.minutes || currentMinutes);
    setStatus(`已改为${later.label}提醒：${formatTime(remindAt)}。`, "ok");
    await render();
  }

  if (button.dataset.action === "pause") {
    button.disabled = true;
    button.textContent = "正在暂停...";
    const result = await sendMessage({ type: "pause", id: item.id });
    if (!result.ok) {
      setStatus(`暂停失败：${result.errorText || "请确认本机同步服务已启动"}`, "bad");
      button.disabled = false;
      button.textContent = "暂停";
      return;
    }
    setStatus("已暂停，并同步到飞书。", "ok");
    await render();
  }

  if (button.dataset.action === "resume") {
    button.disabled = true;
    button.textContent = "正在恢复...";
    const result = await sendMessage({ type: "resume", id: item.id });
    if (!result.ok) {
      setStatus(`恢复失败：${result.errorText || "请确认本机同步服务已启动"}`, "bad");
      button.disabled = false;
      button.textContent = "恢复计时";
      return;
    }
    const remindAt = result.item?.remindAt || minutesFromNow(reminderMinutesFor(item));
    setStatus(`已恢复计时，${formatTime(remindAt)} 提醒。`, "ok");
    await render();
  }

  if (button.dataset.action === "open" && item.sourceUrl) {
    await chrome.tabs.create({ url: item.sourceUrl });
  }

  if (button.dataset.action === "delete") {
    await cancelSchedule(item);
    await saveItems(items.filter(entry => entry.id !== item.id));
    await render();
  }
});

init();
