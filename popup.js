function getCurrentUrl(callback) {
  let queryOptions = { active: true, lastFocusedWindow: true };
  chrome.tabs.query(queryOptions, (tabs) => {
    // get the first tab if exists
    if (tabs && tabs.length > 0) {
      callback(new URL(tabs[0].url));
    } else {
      callback(null);
    }
  });
}

function addTabOption(name, chapterId) {
  const tabs = document.getElementById("tabs");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = chapterId;
  checkbox.name = "tabs";
  checkbox.value = chapterId;

  const label = document.createElement("label");
  label.htmlFor = checkbox.id;
  label.textContent = name;

  const container = document.createElement("div");
  container.appendChild(checkbox);
  container.appendChild(label);

  tabs.appendChild(container);
}

let brightspaceIdCounter = 0;

function getBrightspaceTabMap(response) {
  const tabs = response?.tabs;
  if (tabs && typeof tabs === "object" && !Array.isArray(tabs)) {
    return tabs;
  }
  return {};
}

function addBrightspaceTab(outerTitle, innerTitles) {
  const tabs = document.getElementById("tabs");
  if (!tabs) return;
  const group = document.createElement("div");
  group.className = "brightspace-group";

  const outerId = `bs-outer-${brightspaceIdCounter++}`;
  const outerRow = document.createElement("div");
  outerRow.className = "brightspace-row brightspace-outer";

  const outerCheckbox = document.createElement("input");
  outerCheckbox.type = "checkbox";
  outerCheckbox.id = outerId;
  outerCheckbox.name = "brightspaceTabs";
  outerCheckbox.value = outerTitle;
  outerCheckbox.dataset.role = "outer";

  const outerLabel = document.createElement("label");
  outerLabel.htmlFor = outerId;
  outerLabel.textContent = outerTitle;

  outerRow.append(outerCheckbox, outerLabel);
  group.append(outerRow);

  const innerCheckboxes = [];

  for (const innerTitle of innerTitles) {
    const innerId = `bs-inner-${brightspaceIdCounter++}`;
    const innerRow = document.createElement("div");
    innerRow.className = "brightspace-row brightspace-inner";

    const innerCheckbox = document.createElement("input");
    innerCheckbox.type = "checkbox";
    innerCheckbox.id = innerId;
    innerCheckbox.name = "brightspaceTabs";
    innerCheckbox.value = innerTitle;
    innerCheckbox.dataset.role = "inner";
    innerCheckbox.dataset.parent = outerId;

    const innerLabel = document.createElement("label");
    innerLabel.htmlFor = innerId;
    innerLabel.textContent = innerTitle;

    innerRow.append(innerCheckbox, innerLabel);
    group.append(innerRow);
    innerCheckboxes.push(innerCheckbox);
  }

  outerCheckbox.addEventListener("change", () => {
    for (const innerCheckbox of innerCheckboxes) {
      innerCheckbox.checked = outerCheckbox.checked;
    }
  });

  tabs.appendChild(group);
}

function getDownloadOptions(options, id) {
  const downloadOptions = document.getElementById("downloadOptions");
  const checkbox = document.createElement("input");
  checkbox.type = "radio";
  checkbox.id = `${id}`;
  checkbox.name = "downloadOptions";
  checkbox.value = options;

  const label = document.createElement("label");
  label.htmlFor = checkbox.id;
  label.textContent = options;

  const container = document.createElement("div");
  container.appendChild(checkbox);
  container.appendChild(label);

  downloadOptions.appendChild(container);
}

function setStatus(message) {
  const status = document.getElementById("status");
  if (status) status.textContent = message;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0] ?? null;
}

async function sendToTab(tabId, message, options = {}) {
  const send = async () => {
    const response = await chrome.tabs.sendMessage(tabId, message, options);
    if (response?.ok === false) {
      throw new Error(response.error ?? "Action failed");
    }
    return response;
  };

  try {
    return await send();
  } catch (err) {
    if (!err?.message?.includes("Receiving end does not exist")) {
      throw err;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return await send();
  }
}

async function downloadGoogleFromPage(tabId, format, chapterTabs = []) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    args: [format, chapterTabs],
    func: (selectedFormat, tabs) => {
      const editorUrl = window.location.href;
      if (
        !/docs\.google\.com\/(document|presentation|spreadsheets)\/d\//.test(
          editorUrl,
        )
      ) {
        return;
      }

      const toExport = (tabId) =>
        editorUrl.replace(
          /\/edit.*$/,
          `/export?format=${selectedFormat}${tabId ? `&tab=${tabId}` : ""}`,
        );

      if (tabs.length === 0) {
        window.open(toExport());
      } else {
        for (const tabId of tabs) {
          window.open(toExport(tabId));
        }
      }
    },
  });
}

async function downloadBrightspaceFromPage(tabId, format, tabs) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [format, tabs],
    func: async (selectedFormat, selectedTabs) => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (text) => text?.replace(/\s+/g, " ").trim();

      const getDocumentWithSelector = (selector) => {
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
      };

      const getBrightspaceTabLink = () => {
        const root = getDocumentWithSelector(".header-button-tray");
        const el = root.querySelector(".header-button-tray");
        const parent = el?.parentElement;
        const key =
          parent && Object.keys(parent).find((k) => k.startsWith("__react"));
        let inst = key ? parent[key] : null;

        while (inst && !inst._instance?.state?.selectedContentObject?.Url) {
          inst = inst._currentElement?._owner || inst.return;
        }
        return inst?._instance?.state?.selectedContentObject?.Url;
      };

      const getTopicElement = (title) => {
        const root = getDocumentWithSelector(".navigation-tree");
        const wantedTitle = normalize(title);
        for (const item of root.querySelectorAll(".navigation-item")) {
          const topic = item.querySelector(".topic");
          const titleText = normalize(
            topic?.querySelector(".title-text span")?.textContent,
          );

          if (topic && titleText === wantedTitle) {
            return (
              topic.querySelector(".topic-box[role='treeitem']") ||
              topic.querySelector(".title-container") ||
              topic
            );
          }
        }
        return null;
      };

      const downloadFromUrl = (url) => {
        window.open(
          url.replace(/\/edit.*$/, `/export?format=${selectedFormat}`),
        );
      };

      const selectedTitles = (selectedTabs ?? [])
        .map(normalize)
        .filter(Boolean);
      if (selectedTitles.length === 0) {
        const url = getBrightspaceTabLink();
        if (!url) return { downloaded: 0, missing: [] };
        downloadFromUrl(url);
        return { downloaded: 1, missing: [] };
      }

      const missing = [];
      let downloaded = 0;

      for (const title of selectedTitles) {
        const topicElement = getTopicElement(title);
        if (!topicElement) {
          missing.push(title);
          continue;
        }

        topicElement.scrollIntoView({ block: "center" });
        topicElement.click();
        await delay(750);

        const url = getBrightspaceTabLink();
        if (!url) {
          missing.push(title);
          continue;
        }

        downloadFromUrl(url);
        downloaded++;
        await delay(250);
      }

      return { downloaded, missing };
    },
  });

  const result = results[0]?.result;
  if (!result?.downloaded) {
    throw new Error("Could not find the current Brightspace tab link");
  }
  if (result.missing?.length) {
    throw new Error(
      `Downloaded ${result.downloaded}; missing: ${result.missing.join(", ")}`,
    );
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const tab = await getActiveTab();
  if (!tab?.url || !tab.id) return;

  const domain = tab.url;

  if (domain.includes("elearningontario")) {
    getDownloadOptions("PDF Document ( pdf)", "pdf");
    getDownloadOptions("Plain Text (.txt)", "txt");

    setStatus("Loading tabs...");

    const response = await sendToTab(tab.id, {
      action: "getBrightspaceTabs",
    });
    const tabMap = getBrightspaceTabMap(response);
    const entries = Object.entries(tabMap);

    if (entries.length === 0) {
      setStatus("No tabs found on this page.");
      return;
    }

    for (const [outerTitle, innerTitles] of entries) {
      addBrightspaceTab(outerTitle, innerTitles ?? []);
    }
    setStatus("");

    const form = document.getElementById("downloadForm");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const selectedFormat = document.querySelector(
        'input[name="downloadOptions"]:checked',
      )?.id;

      const selectedTabs = Array.from(
        e.target.querySelectorAll(
          'input[name="brightspaceTabs"][data-role="inner"]:checked',
        ),
      );

      if (!selectedFormat) {
        setStatus("Select a download format.");
        return;
      }

      if (!tab?.id) {
        setStatus("No active tab.");
        return;
      }

      setStatus("Downloading...");
      try {
        await downloadBrightspaceFromPage(
          tab.id,
          selectedFormat,
          selectedTabs.map((el) => el.value),
        );
        setStatus("Done.");
      } catch (err) {
        setStatus(err?.message ?? String(err));
      }
    });
  } else if (domain.includes("docs.google.com/document")) {
    getDownloadOptions("Microsoft Word (docx)", "docx");
    getDownloadOptions("PDF Document ( pdf)", "pdf");
    getDownloadOptions("OpenDocument Format (.odt)", "odt");
    getDownloadOptions("Plain Text (.txt)", "txt");
    getDownloadOptions("Rich Text Format (rtf)", "rtf");
    getDownloadOptions("Web Page (.html, zipped)", "html");
    getDownloadOptions("EPUB Publication (epub)", "epub");
    getDownloadOptions("Markdown (.md)", "md");

    const response = await sendToTab(
      tab.id,
      { action: "getTabs" },
      { frameId: 0 },
    );
    for (const { id, name } of response?.tabs ?? []) {
      addTabOption(name, id);
    }

    const form = document.getElementById("downloadForm");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const selectedFormat = document.querySelector(
        'input[name="downloadOptions"]:checked',
      )?.id;
      const selectedTabElements = Array.from(
        e.target.querySelectorAll('input[name="tabs"]:checked'),
      );

      if (!selectedFormat) {
        setStatus("Select a download format.");
        return;
      }

      setStatus("Downloading...");
      try {
        await downloadGoogleFromPage(
          tab.id,
          selectedFormat,
          selectedTabElements.map((el) => el.value),
        );
        setStatus("Done.");
      } catch (err) {
        setStatus(err?.message ?? String(err));
      }
    });
  } else if (domain.includes("docs.google.com/presentation")) {
    document.getElementById("tabsLabel").style.display = "none";
    getDownloadOptions("Microsoft PowerPoint (pptx)", "pptx");
    getDownloadOptions("ODP Document (odp)", "odp");
    getDownloadOptions("PDF Document (.pdf)", "pdf");
    getDownloadOptions("Plain Text (.txt)", "txt");
    getDownloadOptions("JPEG image (jpg, current slide)", "jpg");
    getDownloadOptions("PNG image (png, current slide)", "png");
    getDownloadOptions("Scalable Vector Graphics (.svg, current slide)", "svg");

    const form = document.getElementById("downloadForm");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const selectedFormat = document.querySelector(
        'input[name="downloadOptions"]:checked',
      )?.id;

      if (!selectedFormat) {
        setStatus("Select a download format.");
        return;
      }

      setStatus("Downloading...");
      try {
        await downloadGoogleFromPage(tab.id, selectedFormat);
        setStatus("Done.");
      } catch (err) {
        setStatus(err?.message ?? String(err));
      }
    });
  } else {
    setStatus("Unsupported page.");
  }
});
