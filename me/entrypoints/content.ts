export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    console.log("Content script loaded on:", window.location.href);

    // Listen for messages from background script
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "EXECUTE_CODE") {
        executeAIGeneratedCode(message.code).then(sendResponse);
        return true; // Keep channel open for async response
      }

      if (message.type === "GET_PAGE_CONTEXT") {
        getPageContext().then(sendResponse);
        return true;
      }
    });

    // Execute AI-generated JavaScript code dynamically
    async function executeAIGeneratedCode(code: string): Promise<any> {
      console.log("Executing AI-generated code:", code);

      try {
        // Create a safe execution context with helpful utilities
        const context = {
          // DOM utilities
          $: (selector: string) => document.querySelector(selector),
          $$: (selector: string) =>
            Array.from(document.querySelectorAll(selector)),

          // Navigation utilities
          navigate: (url: string) => {
            window.location.href = url;
          },
          openNewTab: (url: string) => {
            window.open(url, "_blank");
          },

          // Video utilities
          playVideo: () => {
            const video = document.querySelector("video") as HTMLVideoElement;
            if (video) {
              video.play();
              return "Video playing";
            }
            throw new Error("No video found");
          },
          pauseVideo: () => {
            const video = document.querySelector("video") as HTMLVideoElement;
            if (video) {
              video.pause();
              return "Video paused";
            }
            throw new Error("No video found");
          },

          // Scroll utilities
          scrollDown: (amount = 500) => {
            window.scrollBy({ top: amount, behavior: "smooth" });
            return `Scrolled down ${amount}px`;
          },
          scrollUp: (amount = 500) => {
            window.scrollBy({ top: -amount, behavior: "smooth" });
            return `Scrolled up ${amount}px`;
          },
          scrollToTop: () => {
            window.scrollTo({ top: 0, behavior: "smooth" });
            return "Scrolled to top";
          },
          scrollToBottom: () => {
            window.scrollTo({
              top: document.body.scrollHeight,
              behavior: "smooth",
            });
            return "Scrolled to bottom";
          },

          // Form utilities
          fillInput: (selector: string, value: string) => {
            const input = document.querySelector(selector) as HTMLInputElement;
            if (input) {
              input.value = value;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              return `Filled ${selector} with "${value}"`;
            }
            throw new Error(`Input ${selector} not found`);
          },

          // Click utilities
          click: (selector: string) => {
            const element = document.querySelector(selector) as HTMLElement;
            if (element) {
              element.click();
              return `Clicked ${selector}`;
            }
            throw new Error(`Element ${selector} not found`);
          },

          // Info utilities
          getPageInfo: () => ({
            title: document.title,
            url: window.location.href,
            hasVideo: !!document.querySelector("video"),
            hasForm: !!document.querySelector("form"),
            images: document.querySelectorAll("img").length,
          }),

          // Wait utility
          wait: (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms)),

          // Global access
          window,
          document,
        };

        // Execute the code in the context
        const func = new Function(
          ...Object.keys(context),
          `
          return (async () => {
            ${code}
          })();
        `
        );

        const result = await func(...Object.values(context));

        return {
          success: true,
          message: typeof result === "string" ? result : "Action completed",
          data: result,
        };
      } catch (error) {
        console.error("Error executing code:", error);
        return {
          success: false,
          message: (error as Error).message,
          error: (error as Error).stack,
        };
      }
    }

    // Get context about the current page for AI
    async function getPageContext(): Promise<any> {
      try {
        return {
          success: true,
          context: {
            title: document.title,
            url: window.location.href,
            hasVideo: !!document.querySelector("video"),
            hasForm: !!document.querySelector("form"),
            hasImages: document.querySelectorAll("img").length > 0,
            buttons: Array.from(
              document.querySelectorAll('button, a, [role="button"]')
            )
              .slice(0, 10)
              .map((btn) => btn.textContent?.trim())
              .filter(Boolean),
            inputs: Array.from(document.querySelectorAll("input, textarea"))
              .slice(0, 10)
              .map((input) => ({
                type: (input as HTMLInputElement).type,
                placeholder: (input as HTMLInputElement).placeholder,
                name: (input as HTMLInputElement).name,
              })),
          },
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  },
});
