function downloadTab(format, tab) {
  const currentUrl = window.location.href;

  // get direct export link with tab parameter
  const exportUrl = currentUrl.replace(
    /\/edit.*$/,
    `/export?format=${format}&tab=${tab}`,
  );
  window.open(exportUrl);
}

function downloadAllTabs(format, url = null) {
  if (url) {
    window.open(url.replace(/\/edit.*$/, `/export?format=${format}`));
  } else {
    window.open(
      window.location.href.replace(/\/edit.*$/, `/export?format=${format}`),
    );
  }
}

async function downloadFile(args) {
  const format = typeof args === "string" ? args : args?.format;
  const tabs = typeof args === "string" ? [args] : (args?.tabs ?? []);

  if (!format) {
    throw new Error("No format specified");
  }

  if (tabs.length === 0) {
    downloadAllTabs(format);
  } else {
    for (const tab of tabs) {
      downloadTab(format, tab);
    }
  }
}

function getTabs() {
  const containers = document.querySelectorAll(
    ".chapter-container.chapter-container-level-0",
  );

  const seen = new Set();
  return Array.from(containers)
    .map((container) => {
      const id = container.id.replace(/^chapter-container-/, "");
      const name =
        container
          .querySelector(".chapter-label-content")
          ?.textContent?.trim() ||
        container
          .querySelector(
            ".chapter-item-label-and-buttons-container[role='treeitem']",
          )
          ?.getAttribute("aria-label")
          ?.trim() ||
        "";

      if (!id || !name) return null;
      return { id, name };
    })
    .filter((tab) => {
      if (!tab || seen.has(tab.id)) return false;
      seen.add(tab.id);
      return true;
    });
}

function getNavRoot() {
  if (document.querySelector(".navigation-item")) {
    return document;
  }
  for (const iframe of document.querySelectorAll("iframe")) {
    try {
      const doc = iframe.contentDocument;
      if (doc?.querySelector(".navigation-item")) {
        return doc;
      }
    } catch {
      // cross-origin iframe
    }
  }
  return document;
}

function getDocumentWithSelector(selector) {
  if (document.querySelector(selector)) {
    return document;
  }
  for (const iframe of document.querySelectorAll("iframe")) {
    try {
      const doc = iframe.contentDocument;
      if (doc?.querySelector(selector)) {
        return doc;
      }
    } catch {
      // cross-origin iframe
    }
  }
  return document;
}

async function getBrightspaceTabs() {
  const root = getNavRoot();
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  root
    .querySelectorAll(".navigation-item .title-container")
    .forEach((el) => el.click());
  await delay(500);

  const map = {};
  const outerNavItems = [...root.querySelectorAll(".navigation-item")].filter(
    (item) => item.querySelector(".unit"),
  );

  for (const item of outerNavItems) {
    const outerTitleEl = item.querySelector(".unit .title-text span");
    if (!outerTitleEl) continue;

    const outerTitle = outerTitleEl.textContent.trim();
    const innerTitles = [...item.querySelectorAll(".topic .title-text span")]
      .map((span) => span.textContent.trim())
      .filter(Boolean);

    if (outerTitle) {
      map[outerTitle] = innerTitles;
    }
  }

  return map;
}
function getBrightspaceTabLink() {
  const root = getDocumentWithSelector(".header-button-tray");
  const el = root.querySelector(".header-button-tray");
  const parent = el?.parentElement;
  const key = parent && Object.keys(parent).find((k) => k.startsWith("__react"));
  let inst = key ? parent[key] : null;

  while (inst && !inst._instance?.state?.selectedContentObject?.Url) {
    inst = inst._currentElement?._owner || inst.return;
  }
  return inst?._instance?.state?.selectedContentObject?.Url;
}

function downloadBrightspaceTab(args) {
  const format = typeof args === "string" ? args : args?.format;
  if (!format) {
    throw new Error("No format specified");
  }
  const url = getBrightspaceTabLink();
  if (!url) {
    throw new Error("Could not find the current Brightspace tab link");
  }
  downloadAllTabs(format, url);
}

const actions = {
  downloadFile: downloadFile,
  getTabs: getTabs,
  getBrightspaceTabs: getBrightspaceTabs,
  downloadBrightspaceTab: downloadBrightspaceTab,
};

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  const handler = actions[request.action];
  if (!handler) {
    sendResponse({ ok: false, error: "Action not found" });
    return;
  }

  const finish = (result) => {
    if (Array.isArray(result)) {
      const key = request.action === "getTabs" ? "tabs" : "formats";
      sendResponse({ ok: true, [key]: result });
    } else if (result && typeof result === "object") {
      sendResponse({ ok: true, tabs: result });
    } else {
      sendResponse({ ok: true });
    }
  };

  const run = async () => {
    const result = await Promise.resolve(handler(request.args));

    if (request.action === "getBrightspaceTabs") {
      const map = result ?? {};
      if (Object.keys(map).length === 0) {
        return;
      }
      sendResponse({ ok: true, tabs: map });
      return;
    }

    finish(result);
  };

  run().catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
