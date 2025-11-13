export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    console.log("Content script loaded on:", window.location.href);

    // Listen for messages from background script
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "PERFORM_ACTION") {
        performAction(message.action).then(sendResponse);
        return true; // Keep channel open for async response
      }
    });

    // Helper function to find elements
    function findElement(selector: string): HTMLElement | null {
      return document.querySelector(selector);
    }

    async function performAction(action: string): Promise<any> {
      console.log("Performing action:", action);

      // Parse action with AI or use simple keyword matching
      const actionLower = action.toLowerCase();

      try {
        // Play video action
        if (actionLower.includes("play") && actionLower.includes("video")) {
          const video = document.querySelector("video") as HTMLVideoElement;
          if (video) {
            video.play();
            return { success: true, message: "Video started playing" };
          }
          return { success: false, message: "No video found on page" };
        }

        // Pause video action
        if (actionLower.includes("pause") && actionLower.includes("video")) {
          const video = document.querySelector("video") as HTMLVideoElement;
          if (video) {
            video.pause();
            return { success: true, message: "Video paused" };
          }
          return { success: false, message: "No video found on page" };
        }

        // Click button action
        if (actionLower.includes("click")) {
          const buttons = Array.from(
            document.querySelectorAll('button, a, [role="button"]')
          );

          // Try to find button with matching text
          const matchingButton = buttons.find((btn) => {
            const text = btn.textContent?.toLowerCase() || "";
            return actionLower.split(" ").some((word) => text.includes(word));
          }) as HTMLElement;

          if (matchingButton) {
            matchingButton.click();
            return {
              success: true,
              message: `Clicked: ${matchingButton.textContent}`,
            };
          }
          return { success: false, message: "No matching button found" };
        }

        // Fill form action
        if (actionLower.includes("fill") || actionLower.includes("type")) {
          const input = document.querySelector(
            'input[type="text"], textarea'
          ) as HTMLInputElement;
          if (input) {
            const textToFill =
              action.split(/fill|type/i)[1]?.trim() || "Sample text";
            input.value = textToFill;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return {
              success: true,
              message: `Filled input with: ${textToFill}`,
            };
          }
          return { success: false, message: "No input field found" };
        }

        // Scroll action
        if (actionLower.includes("scroll")) {
          if (actionLower.includes("down")) {
            window.scrollBy({ top: 500, behavior: "smooth" });
            return { success: true, message: "Scrolled down" };
          }
          if (actionLower.includes("up")) {
            window.scrollBy({ top: -500, behavior: "smooth" });
            return { success: true, message: "Scrolled up" };
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
          return { success: true, message: "Scrolled to top" };
        }

        // Get page info
        if (
          actionLower.includes("info") ||
          actionLower.includes("tell me about")
        ) {
          return {
            success: true,
            message: "Page information",
            data: {
              title: document.title,
              url: window.location.href,
              hasVideo: !!document.querySelector("video"),
              hasForm: !!document.querySelector("form"),
              images: document.querySelectorAll("img").length,
            },
          };
        }

        return { success: false, message: "Action not recognized" };
      } catch (error) {
        return { success: false, message: (error as Error).message };
      }
    }
  },
});
