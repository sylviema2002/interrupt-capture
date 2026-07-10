// 中断快记 / Interrupt Capture
// Copyright (c) 2026 马骁艺. Released under the MIT License.

const STORAGE_KEY = "interrupt-capture-extension-items-v1";
const SETTINGS_KEY = "interrupt-capture-extension-settings-v1";
const DEFAULT_REMIND_MINUTES = 15;
const SYNC_SERVICE_URL = "http://127.0.0.1:8766";
const CONFIG_FILE = "sync-config.json";
const reminderWindowByItemId = {};
const REMINDER_WINDOW_WIDTH = 460;
const REMINDER_WINDOW_HEIGHT = 330;
let syncConfigPromise = null;

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

async function loadSyncConfig() {
  if (!syncConfigPromise) {
    syncConfigPromise = fetch(chrome.runtime.getURL(CONFIG_FILE))
      .then(response => {
        if (!response.ok) throw new Error("请先在插件文件夹里创建 sync-config.json。");
        return response.json();
      })
      .then(config => ({
        serviceUrl: config.serviceUrl || SYNC_SERVICE_URL,
        serviceToken: String(config.serviceToken || "").trim()
      }));
  }
  const config = await syncConfigPromise;
  if (!config.serviceToken || config.serviceToken === "CHANGE_ME_TO_A_RANDOM_LOCAL_TOKEN") {
    throw new Error("请先在 sync-config.json 里填写 serviceToken。");
  }
  return config;
}

async function syncRequest(path, item) {
  const config = await loadSyncConfig();
  const response = await fetch(`${config.serviceUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Interrupt-Capture-Token": config.serviceToken
    },
    body: JSON.stringify({ item })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Sync failed with HTTP ${response.status}`);
  }
  return data;
}

async function syncStatusRequest(item, status) {
  const config = await loadSyncConfig();
  const response = await fetch(`${config.serviceUrl}/records/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Interrupt-Capture-Token": config.serviceToken
    },
    body: JSON.stringify({ item, status })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Sync failed with HTTP ${response.status}`);
  }
  return data;
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

function alarmName(id) {
  return `interrupt:${id}`;
}

async function updateBadge() {
  const items = await loadItems();
  const openCount = items.filter(item => !item.done && !item.paused).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#2864d8" });
  await chrome.action.setBadgeText({ text: openCount ? String(openCount) : "" });
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
    console.warn("Reminder window was not shown:", error);
  }
  return { shown: windowShown, errorText: windowErrorText, windowShown, windowErrorText };
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

async function scheduleItem(item) {
  if (!item || item.done || item.paused) return;
  const remindAt = item.remindAt ? new Date(item.remindAt).getTime() : Date.now();
  const delayMs = Math.max(remindAt - Date.now(), 1000);
  await chrome.alarms.create(alarmName(item.id), { when: Date.now() + delayMs });
}

async function restoreSchedules() {
  const items = await loadItems();
  let changed = false;
  for (const item of items) {
    if (item.done || item.paused) {
      await chrome.alarms.clear(alarmName(item.id));
      continue;
    }
    const minutes = reminderMinutesFor(item);
    if (item.reminderMinutes !== minutes) {
      item.reminderMinutes = minutes;
      changed = true;
    }
    if (!item.remindAt) {
      item.remindAt = minutesFromNow(minutes);
      changed = true;
    }
    await scheduleItem(item);
  }
  if (changed) await saveItems(items);
  await updateBadge();
}

async function createSyncedItem(item) {
  const syncResult = await syncRequest("/records", item);
  const items = await loadItems();
  const savedItem = {
    ...item,
    feishuRecordId: syncResult.recordId || "",
    feishuBaseUrl: syncResult.baseUrl || "",
    done: false,
    paused: false
  };
  items.unshift(savedItem);
  await saveItems(items);
  await scheduleItem(savedItem);
  await updateBadge();
  return savedItem;
}

async function completeSyncedItem(id) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return;
  const completedItem = {
    ...item,
    done: true,
    completedAt: new Date().toISOString()
  };
  await syncRequest("/records/complete", completedItem);
  await chrome.alarms.clear(alarmName(id));
  delete reminderWindowByItemId[id];
  await saveItems(items.filter(entry => entry.id !== id));
  await updateBadge();
}

async function pauseSyncedItem(id) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;
  const pausedItem = {
    ...item,
    done: false,
    paused: true,
    pausedAt: new Date().toISOString(),
    remindAt: ""
  };
  await syncStatusRequest(pausedItem, "暂停");
  await chrome.alarms.clear(alarmName(id));
  delete reminderWindowByItemId[id];
  const nextItems = items.map(entry => entry.id === id ? pausedItem : entry);
  await saveItems(nextItems);
  await updateBadge();
  return pausedItem;
}

async function resumeSyncedItem(id) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item) return null;
  const minutes = reminderMinutesFor(item);
  const resumedItem = {
    ...item,
    reminderMinutes: minutes,
    done: false,
    paused: false,
    pausedAt: "",
    remindAt: minutesFromNow(minutes)
  };
  await syncStatusRequest(resumedItem, "未完成");
  const nextItems = items.map(entry => entry.id === id ? resumedItem : entry);
  await saveItems(nextItems);
  await scheduleItem(resumedItem);
  await updateBadge();
  return resumedItem;
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
    paused: false,
    pausedAt: "",
    remindAt
  };
  const nextItems = items.map(entry => entry.id === id ? updatedItem : entry);
  await saveItems(nextItems);
  await scheduleItem(updatedItem);
  await updateBadge();
  return updatedItem;
}

async function handleDueItem(id) {
  const items = await loadItems();
  const item = items.find(entry => entry.id === id);
  if (!item || item.done || item.paused) return;

  await showReminder(item);

  item.lastRemindedAt = new Date().toISOString();
  item.reminderMinutes = reminderMinutesFor(item);
  item.remindAt = minutesFromNow(item.reminderMinutes);
  await saveItems(items);
  await scheduleItem(item);
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

      if (message?.type === "schedule" && message.item) {
        await scheduleItem(message.item);
        await updateBadge();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "createItem" && message.item) {
        const item = await createSyncedItem(message.item);
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
        await completeSyncedItem(message.id);
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "snooze" && message.id) {
        const items = await loadItems();
        const item = items.find(entry => entry.id === message.id);
        if (item) {
          const minutes = normalizeReminderMinutes(message.minutes || item.reminderMinutes || DEFAULT_REMIND_MINUTES);
          item.reminderMinutes = minutes;
          item.done = false;
          item.paused = false;
          item.pausedAt = "";
          item.remindAt = minutesFromNow(minutes);
          await saveItems(items);
          await scheduleItem(item);
        }
        delete reminderWindowByItemId[message.id];
        await updateBadge();
        sendResponse({ ok: true, item: item || null });
        return;
      }

      if (message?.type === "reschedule" && message.id) {
        const item = await rescheduleItem(message.id, message.minutes, message.remindAt);
        sendResponse({ ok: true, item });
        return;
      }

      if (message?.type === "pause" && message.id) {
        const item = await pauseSyncedItem(message.id);
        sendResponse({ ok: true, item });
        return;
      }

      if (message?.type === "resume" && message.id) {
        const item = await resumeSyncedItem(message.id);
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
