import { useState, useEffect } from "react";
import "./App.css";

interface Tab {
  id?: number;
  title?: string;
  url?: string;
  active?: boolean;
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [command, setCommand] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTabs();
    loadApiKey();
  }, []);

  const loadApiKey = async () => {
    const result = await browser.storage.local.get("geminiApiKey");
    if (result.geminiApiKey) {
      setApiKey(result.geminiApiKey);
    }
  };

  const saveApiKey = async () => {
    await browser.storage.local.set({ geminiApiKey: apiKey });
    setResponse("API Key saved!");
  };

  const loadTabs = async () => {
    const result = await browser.runtime.sendMessage({ type: "GET_ALL_TABS" });
    if (result.success) {
      setTabs(result.tabs);
      const active = result.tabs.find((t: Tab) => t.active);
      setActiveTab(active || null);
    }
  };

  const executeCommand = async () => {
    if (!command.trim()) return;

    setLoading(true);
    setResponse("Processing...");

    try {
      if (!activeTab?.id) {
        setResponse("No active tab found");
        return;
      }

      // First, get AI interpretation of the command
      if (apiKey) {
        const aiPrompt = `Given this user command: "${command}"
        
Extract the action to perform on a webpage. Respond with a JSON object:
{
  "action": "the specific action (play video, click button, scroll, fill form, etc)",
  "target": "what element to target if any",
  "value": "any value needed for the action"
}

Only respond with the JSON, nothing else.`;

        const aiResult = await browser.runtime.sendMessage({
          type: "GEMINI_REQUEST",
          payload: { prompt: aiPrompt, apiKey },
        });

        if (aiResult.success) {
          setResponse(`AI Understanding: ${aiResult.text}\n\nExecuting...`);
        }
      }

      // Execute the action
      const result = await browser.runtime.sendMessage({
        type: "EXECUTE_ACTION",
        payload: {
          action: command,
          tabId: activeTab.id,
        },
      });

      if (result.success) {
        setResponse(
          `✅ Success: ${result.response?.message || "Action completed"}`
        );
      } else {
        setResponse(`❌ Error: ${result.error || result.response?.message}`);
      }
    } catch (error) {
      setResponse(`❌ Error: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const askAI = async () => {
    if (!apiKey) {
      setResponse("Please set your Gemini API key first");
      return;
    }

    if (!command.trim()) return;

    setLoading(true);
    try {
      const result = await browser.runtime.sendMessage({
        type: "GEMINI_REQUEST",
        payload: {
          prompt: command,
          apiKey,
        },
      });

      if (result.success) {
        setResponse(result.text);
      } else {
        setResponse(`Error: ${result.error}`);
      }
    } catch (error) {
      setResponse(`Error: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>🤖 AI Assistant</h1>
      </header>

      <section className="api-key-section">
        <h3>Gemini API Key</h3>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Enter your Gemini API key"
        />
        <button onClick={saveApiKey}>Save Key</button>
      </section>

      <section className="active-tab-section">
        <h3>Active Tab</h3>
        {activeTab ? (
          <div className="tab-info">
            <p>
              <strong>{activeTab.title}</strong>
            </p>
            <p className="url">{activeTab.url}</p>
          </div>
        ) : (
          <p>No active tab</p>
        )}
        <button onClick={loadTabs}>Refresh Tabs</button>
      </section>

      <section className="command-section">
        <h3>Command</h3>
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="E.g., 'play the video', 'click the buy button', 'scroll down'"
          rows={3}
        />
        <div className="button-group">
          <button onClick={executeCommand} disabled={loading}>
            {loading ? "Executing..." : "Execute Action"}
          </button>
          <button onClick={askAI} disabled={loading || !apiKey}>
            Ask AI
          </button>
        </div>
      </section>

      {response && (
        <section className="response-section">
          <h3>Response</h3>
          <div className="response-box">{response}</div>
        </section>
      )}

      <section className="tabs-section">
        <h3>All Tabs ({tabs.length})</h3>
        <div className="tabs-list">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`tab-item ${tab.active ? "active" : ""}`}
            >
              <span className="tab-title">{tab.title}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default App;
