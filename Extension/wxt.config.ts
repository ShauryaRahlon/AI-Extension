import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "AI Assistant",
    description: "AI-powered browser assistant with sidebar",
    permissions: [
      "activeTab",
      "tabs",
      "storage",
      "scripting",
      "identity",
    ],
    host_permissions: ["<all_urls>"],
  },
});