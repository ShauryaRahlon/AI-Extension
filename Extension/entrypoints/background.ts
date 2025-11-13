// --- START: Interfaces for Tab Tracking (from your Plasmo project) ---
interface TabInfo {
  id?: number;
  url?: string;
  title?: string;
  favIconUrl?: string;
}

interface TabsData {
  allTabs: TabInfo[];
  activeTab: TabInfo;
  totalTabs: number;
  lastUpdated: string;
}
// --- END: Interfaces for Tab Tracking ---

export default defineBackground(() => {
  console.log("Background service worker started");

  // --- START: Logic from WXT AI Assistant (Your Friend's Code) ---
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received message:", message);

    if (message.type === "GET_ACTIVE_TAB") {
      handleGetActiveTab().then(sendResponse);
      return true; // Keep channel open for async response
    }

    if (message.type === "GET_ALL_TABS") {
      handleGetAllTabs().then(sendResponse); // This is used by the side panel
      return true;
    }

    if (message.type === "EXECUTE_ACTION") {
      handleExecuteAction(message.payload).then(sendResponse);
      return true;
    }

    if (message.type === "GEMINI_REQUEST") {
      handleGeminiRequest(message.payload).then(sendResponse);
      return true;
    }
  });
  // --- END: Logic from WXT AI Assistant ---

  
  // --- START: Tab Tracking Logic (from your Plasmo Project) ---
  // These listeners update the storage for the new Popup
  console.log("Tab tracking for popup is now active");

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
      storeTabsInfo();
    }
  });

  browser.tabs.onActivated.addListener(() => {
    storeTabsInfo();
  });

  browser.tabs.onCreated.addListener(() => {
    storeTabsInfo();
  });

  browser.tabs.onRemoved.addListener(() => {
    storeTabsInfo();
  });

  // Initial store on load
  storeTabsInfo();
  // --- END: Tab Tracking Logic ---
});

// =================================================================
// HELPER FUNCTIONS
// =================================================================

// --- START: Helpers from WXT AI Assistant ---

async function handleGetActiveTab() {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    return { success: true, tab };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function handleGetAllTabs() {
  try {
    const tabs = await browser.tabs.query({});
    return { success: true, tabs };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function handleExecuteAction(payload: any) {
  try {
    const { action, tabId } = payload;

    // Inject content script if needed
    // Note: Make sure this file path is correct in the WXT project
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["/content-scripts/content.js"],
    });

    // Send action to content script
    const response = await browser.tabs.sendMessage(tabId, {
      type: "PERFORM_ACTION",
      action,
    });

    return { success: true, response };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

async function handleGeminiRequest(payload: any) {
  try {
    const { prompt, apiKey } = payload;

    // Import Gemini dynamically
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return { success: true, text };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// --- END: Helpers from WXT AI Assistant ---


// --- START: Helpers for Tab Tracking (from your Plasmo Project) ---
// These functions write to storage for the popup

async function getAllTabsInfo(): Promise<TabsData | null> {
  try {
    const allTabs = await browser.tabs.query({});
    const [activeTab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    const allTabsUrls: TabInfo[] = allTabs.map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
    }));

    const activeTabInfo: TabInfo = {
      id: activeTab?.id,
      url: activeTab?.url,
      title: activeTab?.title,
      favIconUrl: activeTab?.favIconUrl,
    };

    return {
      allTabs: allTabsUrls,
      activeTab: activeTabInfo,
      totalTabs: allTabsUrls.length,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching tabs for popup:", error);
    return null;
  }
}

async function storeTabsInfo(): Promise<TabsData | null> {
  const tabsInfo = await getAllTabsInfo();
  if (tabsInfo) {
    // Use standard browser.storage.local.set
    await browser.storage.local.set({
      tabsData: tabsInfo,
      allTabsUrls: tabsInfo.allTabs,
      activeTabUrl: tabsInfo.activeTab,
      totalTabs: tabsInfo.totalTabs,
      lastUpdated: tabsInfo.lastUpdated,
    });
    // console.log("Tabs info stored for popup:", tabsInfo);
    return tabsInfo;
  }
  return null;
}
// --- END: Helpers for Tab Tracking ---