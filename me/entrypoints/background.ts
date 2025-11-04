export default defineBackground(() => {
  console.log("Background service worker started");

  // Listen for messages from content scripts and sidebar
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received message:", message);

    if (message.type === "GET_ACTIVE_TAB") {
      handleGetActiveTab().then(sendResponse);
      return true; // Keep channel open for async response
    }

    if (message.type === "GET_ALL_TABS") {
      handleGetAllTabs().then(sendResponse);
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

  // Toggle sidebar when extension icon is clicked
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id) {
      await browser.sidePanel.open({ tabId: tab.id });
    }
  });
});

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
