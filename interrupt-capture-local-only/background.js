// 中断快记 / Interrupt Capture
// Copyright (c) 2026 马骁艺. Released under the MIT License.

const STORAGE_KEY = "interrupt-capture-local-only-items-v1";
const SETTINGS_KEY = "interrupt-capture-local-only-settings-v1";
const DEFAULT_REMIND_MINUTES = 15;
const reminderWindowByItemId = {};
const REMINDER_WINDOW_WIDTH = 460;
const REMINDER_WINDOW_HEIGHT = 330;

async function loadItems() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}

async function saveItems(items) {
  await chrome.storage.local.set({ [STORAGE_KEY]: items });
}

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] || {};
}

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function normalizeReminderMinutes(value) {
  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes)) return DEFAULT_REMIND_MINUTES;
  return Math.min(Math.max(minutes, 1), 1440);
}

function reminderMinutesFor(item) {
  return normalizeReminderMinutes(item?.reminderMinutes || DEFAULT_REMIND_MINUTES);
}

function categoryFor(item) {
  if (["interrupt", "planned", "inbox"].includes(item?.category)) return item.category;
  if (item?.calendarStartAt) return "planned";
  return item?.paused ? "inbox" : "interrupt";
}

function normalizeItem(item) {
  const category = categoryFor(item);
  item.category = category;
  item.reminderMinutes = reminderMinutesFor(item);
  item.paused = category !== "interrupt";
  if (category === "inbox") item.remindAt = "";
  if (category === "planned" && item.calendarStartAt) item.remindAt = item.calendarStartAt;
  if (category === "interrupt" && !item.remindAt) item.remindAt = minutesFromNow(item.reminderMinutes);
  return item;
}

function alarmName(id) {
  return `interrupt:${id}`;
}

async function updateBadge() {
  const items = await loadItems();
  const openCount = items.filter(item => !item.done && categoryFor(item) !== "inbox").length;
  await chrome.action.setBadgeBackgroundColor({ color: "#2864d8" });
  await chrome.action.setBadgeText({ text: openCount ? String(openCount) : "" });
}

function getDisplayInfo() {
  if (!chrome.system?.display?.getInfo) return Promise.resolve([]);
  return new Promise(resolve => chrome.system.display.getInfo(displays => resolve(displays || [])));
}

async function getReferenceWindow() {
  try {
    return await chrome.windows.getLastFocused();
  } catch {
    return null;
  }
}

function pickDisplay(displays, referenceWindow) {
  if (!displays.length) return null;
  if (referenceWindow) {
    const centerX = referenceWindow.left + referenceWindow.width / 2;
    const centerY = referenceWindow.top + referenceWindow.height / 2;
    const display = displays.find(entry => {
      const area = entry.workArea || entry.bounds;
      return centerX >= area.left && centerX <= area.left + area.width
        && centerY >= area.top && centerY <= area.top + area.height;
    });
    if (display) return display;
  }
  return displays.find(entry => entry.isPrimary) || displays[0];
}

async function getCenteredReminderBounds() {
  const displays = await getDisplayInfo();
  const referenceWindow = await getReferenceWindow();
  const display = pickDisplay(displays, referenceWindow);
  const area = display?.workArea || display?.bounds;
  if (!area) {
    return { width: REMINDER_WINDOW_WIDTH, height: REMINDER_WINDOW_HEIGHT };
  }
  return {
    left: Math.round(area.left + (area.width - REMINDER_WINDOW_WIDTH) / 2),
    top: Math.round(area.top + (area.height - REMINDER_WINDOW_HEIGHT) / 2),
    width: REMINDER_WINDOW_WIDTH,
    height: REMINDER_WINDOW_HEIGHT
  };
}

async function focusReminderWindow(windowId, bounds = {}) {
  try {
    await chrome.windows.update(windowId, {
      ...bounds,
      state: "normal",
      focused: true,
      drawAttention: true
    });
  } catch {
    await chrome.windows.update(windowId, {
      ...bounds,
      state: "normal",
      focused: true
    });
  }
}

async function findExistingReminderTargets(itemId) {
  const allWindows = await chrome.windows.getAll({ populate: true });
  const encodedId = encodeURIComponent(itemId);
  const reminderPath = chrome.runtime.getURL("reminder.html");
  const targets = [];

  for (const browserWindow of allWindows) {
    for (const tab of browserWindow.tabs || []) {
      const url = tab.url || "";
      if (!url.startsWith(reminderPath)) continue;
      if (url.includes(`id=${encodedId}`) || url.includes(`id=${itemId}`)) {
        targets.push({ windowId: browserWindow.id, tabId: tab.id });
      }
    }
  }

  return targets;
}

async function openReminderWindow(item, immediate = false) {
  const params = new URLSearchParams();
  params.set("id", item.id);
  if (immediate) params.set("test", "1");
  if (item.id === "test") {
    params.set("text", item.text);
    params.set("sourceTitle", item.sourceTitle || "");
    params.set("sourceUrl", item.sourceUrl || "");
  }
  const reminderUrl = chrome.runtime.getURL(`reminder.html?${params.toString()}`);
  const centeredBounds = await getCenteredReminderBounds();

  if (!immediate) {
    const existingTargets = await findExistingReminderTargets(item.id);
    if (existingTargets.length) {
      const target = existingTargets[0];
      await chrome.tabs.update(target.tabId, { url: reminderUrl, active: true });
      await focusReminderWindow(target.windowId, centeredBounds);
      reminderWindowByItemId[item.id] = target.windowId;
      return;
    }
  }

  if (!immediate && reminderWindowByItemId[item.id]) {
    try {
      await focusReminderWindow(reminderWindowByItemId[item.id], centeredBounds);
      return;
    } catch {
      // The old reminder window may already be closed by the user.
    }
    delete reminderWindowByItemId[item.id];
  }

  const reminderWindow = await chrome.windows.create({
    url: reminderUrl,
    type: "popup",
    focused: true,
    ...centeredBounds
  });
  if (!immediate && reminderWindow?.id != null) {
    reminderWindowByItemId[item.id] = reminderWindow.id;
  }
}

async function showReminder(item, immediate = false) {
  let windowShown = true;
  let windowErrorText = "";

  await chrome.action.setBadgeBackgroundColor({ color: "#b96500" });
  await chrome.action.setBadgeText({ text: "!" });

  try {
    await openReminderWindow(item, immediate);
  } catch (error) {
    windowShown = false;
    windowErrorText = error?.message || String(error);
  }

  return { shown: windowShown, errorText: windowErrorText, windowShown, windowErrorText };
}

async function scheduleItem(item) {
  if (!item || item.done || categoryFor(item) === "inbox") return;
  const target = categoryFor(item) === "planned" ? item.calendarStartAt : item.remindAt;
  if (!target) return;
  const when = new Date(target).getTime();
  if (!Number.isFinite(when)) return;
  await chrome.alarms.create(alarmName(item.id), { when: Math.max(when, Date.now() + 1000) });
}

async function restoreSchedules() {
  const items = await loadItems();
  let changed = false;
  for (const item of items) {
    const before = JSON.stringify(item);
    normalizeItem(item);
    if (item.done || item.category === "inbox") {
      await chrome.alarms.clear(alarmName(item.id));
      continue;
    }
    await scheduleItem(item);
    if (before !== JSON.stringify(item)) changed = true;
  }
  if (changed) await saveItems(items);
  await updateBadge();
}

async function createItem(item) {
  const items = await loadItems();
  const savedItem = normalizeItem({ ...item, done: false });
  items.unshift(savedItem);
  await saveItems(items);
  await scheduleItem(savedItem);
  await updateBadge();
  return savedItem;
}

async function completeItem(id) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;
  const completedItem = {
    ...item,
    done: true,
    paused: false,
    pausedAt: "",
    remindAt: "",
    completedAt: new Date().toISOString()
  };
  await chrome.alarms.clear(alarmName(id));
  delete reminderWindowByItemId[id];
  await saveItems(items.map(entry => entry.id === id ? completedItem : entry));
  await updateBadge();
  return completedItem;
}

async function pauseItem(id) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;
  const pausedItem = {
    ...item,
    category: "inbox",
    done: false,
    paused: true,
    pausedAt: new Date().toISOString(),
    remindAt: "",
    calendarStartAt: "",
    calendarEndAt: "",
    planningStartedAt: ""
  };
  await chrome.alarms.clear(alarmName(id));
  delete reminderWindowByItemId[id];
  await saveItems(items.map(entry => entry.id === id ? pausedItem : entry));
  await updateBadge();
  return pausedItem;
}

async function resumeItem(id) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;
  const minutes = reminderMinutesFor(item);
  const resumedItem = {
    ...item,
    category: "interrupt",
    reminderMinutes: minutes,
    done: false,
    paused: false,
    pausedAt: "",
    remindAt: minutesFromNow(minutes),
    calendarStartAt: "",
    calendarEndAt: "",
    planningStartedAt: ""
  };
  await saveItems(items.map(entry => entry.id === id ? resumedItem : entry));
  await scheduleItem(resumedItem);
  await updateBadge();
  return resumedItem;
}

async function snoozeItem(id) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;
  const minutes = reminderMinutesFor(item);
  item.reminderMinutes = minutes;
  item.category = "interrupt";
  item.done = false;
  item.paused = false;
  item.pausedAt = "";
  item.remindAt = minutesFromNow(minutes);
  item.calendarStartAt = "";
  item.calendarEndAt = "";
  item.planningStartedAt = "";
  await saveItems(items);
  await scheduleItem(item);
  delete reminderWindowByItemId[id];
  await updateBadge();
  return item;
}

async function rescheduleItem(id, minutesValue, remindAtValue = "") {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;
  const minutes = normalizeReminderMinutes(minutesValue);
  const absoluteRemindAt = remindAtValue ? new Date(remindAtValue) : null;
  const remindAt = absoluteRemindAt && absoluteRemindAt.getTime() > Date.now()
    ? absoluteRemindAt.toISOString()
    : minutesFromNow(minutes);
  const updatedItem = {
    ...item,
    reminderMinutes: remindAtValue ? reminderMinutesFor(item) : minutes,
    done: false,
    category: "interrupt",
    paused: false,
    pausedAt: "",
    remindAt,
    calendarStartAt: "",
    calendarEndAt: "",
    planningStartedAt: ""
  };
  await saveItems(items.map(entry => entry.id === id ? updatedItem : entry));
  await scheduleItem(updatedItem);
  await updateBadge();
  return updatedItem;
}

async function moveToInbox(id) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;
  const updatedItem = {
    ...item,
    category: "inbox",
    done: false,
    paused: true,
    pausedAt: new Date().toISOString(),
    remindAt: "",
    calendarStartAt: "",
    calendarEndAt: "",
    planningStartedAt: ""
  };
  await chrome.alarms.clear(alarmName(id));
  delete reminderWindowByItemId[id];
  await saveItems(items.map(entry => entry.id === id ? updatedItem : entry));
  await updateBadge();
  return updatedItem;
}

async function planItem(id, startAt, endAt) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;
  const startDate = new Date(startAt);
  const endDate = new Date(endAt);
  if (!Number.isFinite(startDate.getTime()) || startDate.getTime() <= Date.now()) {
    throw new Error("规划开始时间无效或已经过去。");
  }
  if (!Number.isFinite(endDate.getTime()) || endDate.getTime() <= startDate.getTime()) {
    throw new Error("规划结束时间要晚于开始时间。");
  }
  const updatedItem = {
    ...item,
    category: "planned",
    done: false,
    paused: true,
    pausedAt: "",
    remindAt: startDate.toISOString(),
    calendarStartAt: startDate.toISOString(),
    calendarEndAt: endDate.toISOString(),
    planningStartedAt: ""
  };
  await saveItems(items.map(entry => entry.id === id ? updatedItem : entry));
  await scheduleItem(updatedItem);
  await updateBadge();
  return updatedItem;
}

async function deleteItem(id) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;
  await chrome.alarms.clear(alarmName(id));
  delete reminderWindowByItemId[id];
  await saveItems(items.filter(entry => entry.id !== id));
  await updateBadge();
  return item;
}

async function handleDueItem(id) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item || item.done || categoryFor(item) === "inbox") return;

  await showReminder(item);
  item.lastRemindedAt = new Date().toISOString();
  if (categoryFor(item) === "planned") {
    item.planningStartedAt = item.lastRemindedAt;
    item.remindAt = "";
    await saveItems(items);
    return;
  }
  item.reminderMinutes = reminderMinutesFor(item);
  item.remindAt = minutesFromNow(item.reminderMinutes);
  await saveItems(items);
  await scheduleItem(item);
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
    const category = categoryFor(item);
    const status = item.done ? "已完成" : category === "planned" ? "规划任务" : category === "inbox" ? "待安排" : "中断任务";
    const source = item.sourceTitle || item.sourceUrl || "未记录来源";
    const lines = [
      `${index + 1}. [${status}] ${item.text}`,
      `记录时间：${formatExportTime(item.createdAt) || "未记录"}`,
      `来源：${source}`
    ];
    if (category === "planned" && item.calendarStartAt) {
      const startText = formatExportTime(item.calendarStartAt);
      const endText = formatExportTime(item.calendarEndAt);
      lines.push(`规划时间：${startText}${endText ? ` - ${endText}` : ""}`);
    }
    if (item.completedAt) lines.push(`完成时间：${formatExportTime(item.completedAt)}`);
    return lines.join("\n");
  }).join("\n\n");
}

async function downloadTxt() {
  const items = await loadItems();
  const content = exportText(items);
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
  await chrome.downloads.download({
    url,
    filename: `中断快记-全部记录-${new Date().toISOString().slice(0, 10)}.txt`,
    saveAs: true
  });
}

async function cleanupCompleted() {
  const items = await loadItems();
  const nextItems = items.filter(item => !item.done);
  await saveItems(nextItems);
  await updateBadge();
  return items.length - nextItems.length;
}

chrome.runtime.onInstalled.addListener(restoreSchedules);
chrome.runtime.onStartup.addListener(restoreSchedules);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "restore") {
        await restoreSchedules();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "createItem" && message.item) {
        const item = await createItem(message.item);
        sendResponse({ ok: true, item });
        return;
      }

      if (message?.type === "cancel" && message.id) {
        await chrome.alarms.clear(alarmName(message.id));
        delete reminderWindowByItemId[message.id];
        await updateBadge();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "test") {
        const result = await showReminder({
          id: "test",
          text: "如果你看到这个窗口，说明强提醒可用。",
          sourceTitle: "",
          sourceUrl: ""
        }, true);
        sendResponse({ ok: true, ...result });
        return;
      }

      if (message?.type === "getItem" && message.id) {
        if (message.id === "test") {
          sendResponse({ ok: true, item: null });
          return;
        }
        const items = await loadItems();
        sendResponse({ ok: true, item: items.find(entry => entry.id === message.id) || null });
        return;
      }

      if (message?.type === "keepReminderOnTop") {
        const windowId = sender?.tab?.windowId || reminderWindowByItemId[message.id];
        if (windowId != null) {
          await focusReminderWindow(windowId);
          if (message.id) reminderWindowByItemId[message.id] = windowId;
        }
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "complete" && message.id) {
        const item = await completeItem(message.id);
        sendResponse({ ok: true, item });
        return;
      }

      if (message?.type === "snooze" && message.id) {
        const item = await snoozeItem(message.id);
        sendResponse({ ok: true, item });
        return;
      }

      if (message?.type === "reschedule" && message.id) {
        const item = await rescheduleItem(message.id, message.minutes, message.remindAt);
        sendResponse({ ok: true, item });
        return;
      }

      if (message?.type === "pause" && message.id) {
        const item = await pauseItem(message.id);
        sendResponse({ ok: true, item });
        return;
      }

      if (message?.type === "resume" && message.id) {
        const item = await resumeItem(message.id);
        sendResponse({ ok: true, item });
        return;
      }

      if (message?.type === "moveToInbox" && message.id) {
        const item = await moveToInbox(message.id);
        sendResponse({ ok: true, item });
        return;
      }

      if (message?.type === "planItem" && message.id) {
        const item = await planItem(message.id, message.startAt, message.endAt);
        sendResponse({ ok: true, item });
        return;
      }

      if (message?.type === "deleteItem" && message.id) {
        const item = await deleteItem(message.id);
        sendResponse({ ok: true, item });
        return;
      }

      if (message?.type === "openSource" && message.id) {
        const items = await loadItems();
        const item = items.find(entry => entry.id === message.id);
        if (item?.sourceUrl) await chrome.tabs.create({ url: item.sourceUrl });
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "downloadTxt") {
        await downloadTxt();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "cleanupCompleted") {
        const removedCount = await cleanupCompleted();
        sendResponse({ ok: true, removedCount });
        return;
      }

      sendResponse({ ok: false });
    } catch (error) {
      sendResponse({ ok: false, errorText: error?.message || String(error) });
    }
  })();
  return true;
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (!alarm.name.startsWith("interrupt:")) return;
  await handleDueItem(alarm.name.replace("interrupt:", ""));
});

chrome.windows.onRemoved.addListener(windowId => {
  for (const [itemId, reminderWindowId] of Object.entries(reminderWindowByItemId)) {
    if (reminderWindowId === windowId) {
      delete reminderWindowByItemId[itemId];
    }
  }
});

restoreSchedules();
