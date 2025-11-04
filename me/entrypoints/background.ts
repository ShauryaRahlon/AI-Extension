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
    const { command, tabId, apiKey } = payload;

    // Ensure content script is injected first
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        files: ["content-scripts/content.js"],
      });
      // Wait a bit for content script to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (e) {
      // Content script might already be injected, ignore error
      console.log("Content script injection skipped:", e);
    }

    // Get page context
    let pageContext = {};
    try {
      const contextResponse = await browser.tabs.sendMessage(tabId, {
        type: "GET_PAGE_CONTEXT",
      });
      pageContext = contextResponse.success ? contextResponse.context : {};
    } catch (e) {
      console.log("Could not get page context:", e);
      // Continue anyway with empty context
    }

    // Ask AI to generate executable JavaScript code
    const aiPrompt = `You are a JavaScript code generator for browser automation. Given a user command and page context, generate ONLY executable JavaScript code.

User Command: "${command}"

Page Context:
${JSON.stringify(pageContext, null, 2)}

Available Utility Functions:
- $(selector) - querySelector
- $$(selector) - querySelectorAll as array
- navigate(url) - navigate to URL
- openNewTab(url) - open URL in new tab
- playVideo() - play video element
- pauseVideo() - pause video element
- scrollDown(amount?) - scroll down
- scrollUp(amount?) - scroll up
- scrollToTop() - scroll to top
- scrollToBottom() - scroll to bottom
- fillInput(selector, value) - fill input field
- click(selector) - click element
- getPageInfo() - get page information
- wait(ms) - wait milliseconds
- window, document - standard DOM APIs

CRITICAL RULES:
1. Generate ONLY executable JavaScript code, NO explanations
2. Do NOT wrap code in markdown code blocks
3. Use the utility functions when possible
4. Return a descriptive string message about what was done
5. For navigation commands, use navigate() or openNewTab()
6. Handle errors gracefully with try-catch if needed

Examples:

Command: "open youtube"
Code: navigate('https://www.youtube.com'); return 'Opening YouTube';

Command: "play the video"
Code: return playVideo();

Command: "click the login button"
Code: const btn = $$('button').find(b => b.textContent.toLowerCase().includes('login')); if(btn) { btn.click(); return 'Clicked login button'; } else { throw new Error('Login button not found'); }

Command: "scroll down"
Code: return scrollDown();

Command: "search for cats"
Code: const input = $('input[type="search"], input[name="search"], input[placeholder*="search" i]'); if(input) { input.value = 'cats'; input.dispatchEvent(new Event('input', {bubbles: true})); const form = input.closest('form'); if(form) form.submit(); return 'Searching for cats'; } throw new Error('Search input not found');

Now generate code for the user command. Remember: ONLY code, no explanations, no markdown:`;

    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(aiPrompt);
    const response = await result.response;
    let generatedCode = response.text().trim();

    // Clean up the generated code (remove markdown if AI ignored instructions)
    generatedCode = generatedCode
      .replace(/^```(?:javascript|js)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    console.log("Generated code:", generatedCode);

    // Execute the generated code in content script
    try {
      const executeResponse = await browser.tabs.sendMessage(tabId, {
        type: "EXECUTE_CODE",
        code: generatedCode,
      });

      return {
        success: executeResponse.success,
        response: executeResponse,
        generatedCode, // Include for debugging
      };
    } catch (executeError) {
      return {
        success: false,
        error: `Failed to execute code: ${
          (executeError as Error).message
        }. Try reloading the page.`,
        generatedCode,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Error: ${(error as Error).message}`,
    };
  }
}

async function handleGeminiRequest(payload: any) {
  try {
    const { prompt, apiKey } = payload;

    // Import Gemini dynamically
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return { success: true, text };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
