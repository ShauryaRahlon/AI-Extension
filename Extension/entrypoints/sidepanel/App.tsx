import { useState, useEffect } from "react";
import "./App.css";
import { X, RefreshCw } from "lucide-react"; // You'll need to install lucide-react

// --- START: Interfaces from both projects ---
interface Tab {
  id?: number;
  title?: string;
  url?: string;
  active?: boolean;
}

interface PlasmoTabInfo {
  id?: number;
  url?: string;
  title?: string;
  favIconUrl?: string;
}

interface PlasmoTabsData {
  allTabs: PlasmoTabInfo[];
  activeTab: PlasmoTabInfo;
  totalTabs: number;
  lastUpdated: string;
}
// --- END: Interfaces ---

// --- START: Auth Logic from your Plasmo sidepanel.tsx ---

// Backend service URL
const BACKEND_URL = "http://localhost:5000";

// Browser detection utility
const getBrowserInfo = () => {
  const ua = navigator.userAgent || "";
  const hasBrowserApi = typeof browser !== "undefined" && !!browser;
  const isFirefox = hasBrowserApi && ua.includes("Firefox");
  const isChrome = !isFirefox && ua.includes("Chrome");
  let name = "Unknown";
  if (isFirefox) name = "Firefox";
  else if (ua.includes("Edg")) name = "Edge";
  else if (isChrome) name = "Chrome";
  return { name, isFirefox, isChrome };
};

// --- END: Auth Logic ---

function App() {
  // --- STATE from WXT Project ---
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [command, setCommand] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false); // WXT loading state

  // --- STATE from Plasmo Project ---
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true); // Plasmo loading state
  const [showProfile, setShowProfile] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showRefreshToken, setShowRefreshToken] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<string>("");
  const browserInfo = getBrowserInfo();

  // --- START: Merged useEffect and Auth Functions ---

  useEffect(() => {
    // 1. Check Auth Status
    initAuth();

    // 2. Load WXT data (tabs, apikey)
    loadTabs();
    loadApiKey();

    // 3. Set up storage listener for both auth and tabs
    const handleStorageChange = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local") return;

      if (changes.tabsData?.newValue) {
        // You might want to update the AI's tab list here if needed
      }
      if (changes.googleUser?.newValue) {
        setUser(changes.googleUser.newValue);
      }
      if (changes.geminiApiKey?.newValue) {
        setApiKey(changes.geminiApiKey.newValue);
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);

    return () => {
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // --- Auth Functions (Refactored for browser.storage) ---

  const initAuth = async () => {
    const result = await browser.storage.local.get("googleUser");
    let savedUser: any = result.googleUser;

    if (savedUser) {
      await checkAndRefreshToken(savedUser);
      setAuthLoading(false);
    } else {
      setAuthLoading(false);
    }
  };

  const refreshAccessToken = async (refreshToken: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/refresh-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) throw new Error("Failed to refresh token");
      const data = await response.json();
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in || 3600,
      };
    } catch (error) {
      console.error("Error refreshing token:", error);
      return null;
    }
  };

  const checkAndRefreshToken = async (userData: any) => {
    const tokenAge = userData.tokenTimestamp
      ? Date.now() - userData.tokenTimestamp
      : Infinity;

    if (tokenAge > 3300000 && userData.refreshToken) {
      setTokenStatus("🔄 Refreshing token...");
      const refreshResult = await refreshAccessToken(userData.refreshToken);

      if (refreshResult) {
        const updatedUserData = {
          ...userData,
          token: refreshResult.accessToken,
          tokenTimestamp: Date.now(),
          tokenExpiresIn: refreshResult.expiresIn,
        };
        await browser.storage.local.set({ googleUser: updatedUserData }); // REFACTORED
        setUser(updatedUserData);
        setTokenStatus("✅ Token refreshed successfully");
        return;
      } else {
        setTokenStatus("⚠️ Failed to refresh token - please re-authenticate");
        setUser(userData);
        return;
      }
    }
    // ... (rest of the logic is the same)
    if (tokenAge > 3600000 && !userData.refreshToken) {
      setTokenStatus("❌ Token expired - please re-authenticate");
    } else if (userData.refreshToken) {
      setTokenStatus("✅ Token valid (with auto-refresh)");
    } else {
      setTokenStatus("⚠️ Token valid (no refresh token - will expire)");
    }
    setUser(userData);
  };

  const handleLogin = async () => {
    setAuthLoading(true);
    try {
      const identityApi = browser.identity;
      if (!identityApi) throw new Error("browser.identity API not available");

      const redirectUri = identityApi.getRedirectURL();
      const clientId =
        "95116700360-13ege5jmfrjjt4vmd86oh00eu5jlei5e.apps.googleusercontent.com";
      const scopes =
        "openid email profile https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/gmail.readonly";

      const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&scope=${encodeURIComponent(
        scopes
      )}&access_type=offline&prompt=consent`;

      const redirectResponse = await identityApi.launchWebAuthFlow({
        url: authUrl,
        interactive: true,
      });

      const codeMatch = redirectResponse?.match(/code=([^&]+)/);
      const code = codeMatch ? codeMatch[1] : null;
      if (!code) throw new Error("No authorization code found in response");

      const tokenResponse = await fetch(`${BACKEND_URL}/exchange-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code, redirect_uri: redirectUri }),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        throw new Error(`Token exchange failed: ${errorData.error}`);
      }

      const tokenData = await tokenResponse.json();
      const token = tokenData.access_token;
      const refreshToken = tokenData.refresh_token;
      const expiresIn = tokenData.expires_in || 3600;

      const userInfo = await fetch(
        `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${token}`
      ).then((res) => res.json());

      const fullUserData = {
        ...userInfo,
        token,
        refreshToken,
        tokenTimestamp: Date.now(),
        tokenExpiresIn: expiresIn,
        redirectUri,
        loginTime: new Date().toISOString(),
        browser: browserInfo.name,
      };
      await browser.storage.local.set({ googleUser: fullUserData }); // REFACTORED
      setUser(fullUserData);
      setTokenStatus("✅ Token valid (with auto-refresh)");
    } catch (err: any) {
      console.error("Auth Error:", err);
      // Handle user cancellation gracefully
      if (String(err).toLowerCase().includes("user cancelled") || String(err).toLowerCase().includes("denied") || String(err).toLowerCase().includes("aborted")) {
        alert("Authentication cancelled. Please allow access in the popup to sign in.")
      } else {
        alert(`Authentication failed: ${err.message}\n\nMake sure the backend service is running.`);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await browser.storage.local.remove("googleUser"); // REFACTORED
    setUser(null);
    setShowProfile(false);
    setTokenStatus("");
  };

  // --- Helper functions for Profile UI ---
  const getTokenAge = () => {
    if (!user?.tokenTimestamp) return "Unknown";
    const ageMs = Date.now() - user.tokenTimestamp;
    const ageMinutes = Math.floor(ageMs / 60000);
    const ageHours = Math.floor(ageMinutes / 60);
    const remainingMinutes = ageMinutes % 60;

    if (ageHours > 0) {
      return `${ageHours}h ${remainingMinutes}m`;
    }
    return `${ageMinutes}m`;
  };

  const getTokenExpiry = () => {
    if (!user?.tokenTimestamp || !user?.tokenExpiresIn) return "Unknown";
    const expiryTime = new Date(
      user.tokenTimestamp + user.tokenExpiresIn * 1000
    );
    const now = new Date();
    const remainingMs = expiryTime.getTime() - now.getTime();

    if (remainingMs <= 0) return "Expired";

    const remainingMinutes = Math.floor(remainingMs / 60000);
    return `${remainingMinutes} minutes`;
  };

  const handleManualRefresh = async () => {
    if (!user?.refreshToken) {
      alert("No refresh token available. Please re-authenticate.")
      return
    }

    setTokenStatus("🔄 Refreshing token...")

    const refreshResult = await refreshAccessToken(user.refreshToken)

    if (refreshResult) {
      const updatedUserData = {
        ...user,
        token: refreshResult.accessToken,
        tokenTimestamp: Date.now(),
        tokenExpiresIn: refreshResult.expiresIn
      }
      await browser.storage.local.set({ googleUser: updatedUserData })
      setUser(updatedUserData)
      setTokenStatus("✅ Token refreshed successfully")
    } else {
      setTokenStatus("❌ Failed to refresh token")
      alert("Failed to refresh token. Please re-authenticate.")
    }
  }

  // --- WXT Functions (Now complete) ---
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

  // --- START: Render Logic ---

  if (authLoading) {
    return (
      <div className="app">
        <header>
          <h1>🤖 AI Assistant</h1>
        </header>
        <section>
          <h3>Loading...</h3>
        </section>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app">
        <header>
          <h1>🤖 AI Assistant</h1>
        </header>
        <section style={{ textAlign: "center", padding: "40px 20px" }}>
          <h3 style={{ fontSize: "18px", marginBottom: "12px" }}>
            Sign in Required
          </h3>
          <p style={{ color: "#666", marginBottom: "24px" }}>
            Please sign in with Google to use the AI assistant.
          </p>
          <button
            onClick={handleLogin}
            style={{
              background: "#4285f4",
              color: "white",
              padding: "12px 24px",
              fontSize: "16px",
            }}
          >
            Sign in with Google
          </button>
        </section>
      </div>
    );
  }

  // --- User is Logged In: Render AI Assistant ---
  // This is your friend's original UI, wrapped in the auth check
  return (
    <div className="app">
      <header>
        <div style={{ flex: 1 }}>
          <h1>🤖 AI Assistant</h1>
        </div>
        <button
          onClick={() => setShowProfile(!showProfile)}
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            border: "2px solid #4285f4",
            cursor: "pointer",
            padding: 0,
            overflow: "hidden",
            backgroundColor: "#2a2a2a",
          }}
        >
          <img
            src={user.picture}
            alt="profile"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </button>
      </header>

      {/* --- START: Profile UI (from Plasmo) --- */}
      {showProfile && (
        <div
          className="profile-sidebar"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "360px",
            height: "100%",
            backgroundColor: "#1a1a1a",
            borderLeft: "1px solid #2a2a2a",
            zIndex: 1000,
            overflowY: "auto",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.5)",
            color: "white", // Added for base color
          }}
        >
          <div style={{ padding: "20px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "24px",
              }}
            >
              <h3 style={{ margin: 0, color: "#fff", fontSize: "18px" }}>
                Profile
              </h3>
              <button
                onClick={() => setShowProfile(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#999",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* == START: Full Profile Block from Plasmo == */}
            <div
              style={{
                textAlign: "center",
                marginBottom: "24px",
                padding: "20px",
                backgroundColor: "#0a0a0a",
                borderRadius: "12px",
              }}
            >
              <img
                src={user.picture}
                alt="profile"
                style={{
                  width: "80px",
                  height: "80px",
                  borderRadius: "50%",
                  border: "3px solid #4285f4",
                  marginBottom: "12px",
                }}
              />
              <h4 style={{ margin: "0 0 4px 0", color: "#fff" }}>
                {user.name}
              </h4>
              <p style={{ margin: 0, fontSize: "13px", color: "#999" }}>
                {user.email}
              </p>
            </div>

            <div style={{ marginBottom: "16px" }}>
              <div
                style={{
                  padding: "12px",
                  marginBottom: "8px",
                  borderRadius: "8px",
                  backgroundColor: "#0a0a0a",
                }}
              >
                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>
                  User ID
                </div>
                <div style={{ fontSize: "12px", color: "#fff" }}>{user.id}</div>
              </div>
              <div
                style={{
                  padding: "12px",
                  marginBottom: "8px",
                  borderRadius: "8px",
                  backgroundColor: "#0a0a0a",
                }}
              >
                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>
                  Verified Email
                </div>
                <div style={{ fontSize: "12px", color: "#fff" }}>
                  {user.verified_email ? "✅ Yes" : "❌ No"}
                </div>
              </div>
              <div
                style={{
                  padding: "12px",
                  marginBottom: "8px",
                  borderRadius: "8px",
                  backgroundColor: "#0a0a0a",
                }}
              >
                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>
                  Browser
                </div>
                <div style={{ fontSize: "12px", color: "#fff" }}>
                  {browserInfo.name}
                </div>
              </div>
              <div
                style={{
                  padding: "12px",
                  marginBottom: "8px",
                  borderRadius: "8px",
                  backgroundColor: "#0a0a0a",
                }}
              >
                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>
                  Login Time
                </div>
                <div style={{ fontSize: "12px", color: "#fff" }}>
                  {new Date(user.loginTime).toLocaleString()}
                </div>
              </div>

              <details style={{ marginTop: "12px" }} open>
                <summary
                  style={{
                    cursor: "pointer",
                    padding: "8px 12px",
                    backgroundColor: "#0a0a0a",
                    borderRadius: "6px",
                    fontSize: "12px",
                    color: "#999",
                    userSelect: "none",
                  }}
                >
                  🔐 Advanced Details
                </summary>
                <div style={{ marginTop: "8px" }}>
                  <div
                    style={{
                      padding: "12px",
                      marginBottom: "8px",
                      borderRadius: "8px",
                      backgroundColor: "#0a0a0a",
                      wordBreak: "break-word",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11px",
                        color: "#666",
                        marginBottom: "4px",
                      }}
                    >
                      Picture URL
                    </div>
                    <div style={{ fontSize: "12px", color: "#fff" }}>
                      {user.picture}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "12px",
                      marginBottom: "8px",
                      borderRadius: "8px",
                      backgroundColor: "#0a0a0a",
                      wordBreak: "break-word",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11px",
                        color: "#666",
                        marginBottom: "4px",
                      }}
                    >
                      Redirect URI
                    </div>
                    <div style={{ fontSize: "12px", color: "#fff" }}>
                      {user.redirectUri}
                    </div>
                  </div>

                  {user?.tokenTimestamp && (
                    <>
                      <div
                        style={{
                          padding: "12px",
                          marginBottom: "8px",
                          borderRadius: "8px",
                          backgroundColor: "#0a0a0a",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "11px",
                            color: "#666",
                            marginBottom: "4px",
                          }}
                        >
                          Token Age
                        </div>
                        <div style={{ fontSize: "12px", color: "#fff" }}>
                          {getTokenAge()}
                        </div>
                      </div>
                      <div
                        style={{
                          padding: "12px",
                          marginBottom: "8px",
                          borderRadius: "8px",
                          backgroundColor: "#0a0a0a",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "11px",
                            color: "#666",
                            marginBottom: "4px",
                          }}
                        >
                          Token Expires In
                        </div>
                        <div
                          style={{
                            fontSize: "12px",
                            color:
                              getTokenExpiry() === "Expired"
                                ? "#dc2626"
                                : "#fff",
                          }}
                        >
                          {getTokenExpiry()}
                        </div>
                      </div>
                      {user?.refreshToken && (
                        <div
                          style={{
                            padding: "12px",
                            marginBottom: "8px",
                            borderRadius: "8px",
                            backgroundColor: "#0a0a0a",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "11px",
                              color: "#666",
                              marginBottom: "4px",
                            }}
                          >
                            Has Refresh Token
                          </div>
                          <div style={{ fontSize: "12px", color: "#4ade80" }}>
                            ✅ Yes (auto-refresh enabled)
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {user?.token && (
                    <div
                      style={{
                        padding: "12px",
                        marginBottom: "8px",
                        borderRadius: "8px",
                        backgroundColor: "#0a0a0a",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "11px",
                            color: "#666",
                            marginBottom: "4px",
                          }}
                        >
                          Access Token
                        </div>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#fff",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: showToken ? "normal" : "nowrap",
                            filter: showToken ? "none" : "blur(4px)",
                            wordBreak: "break-all",
                          }}
                        >
                          {showToken
                            ? user.token
                            : String(user.token).length > 48
                              ? String(user.token).substring(0, 48) + "..."
                              : user.token}
                        </div>
                      </div>
                      <button
                        onClick={() => setShowToken(!showToken)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#2196F3",
                          cursor: "pointer",
                          fontSize: "12px",
                          padding: "6px 10px",
                          whiteSpace: "nowrap",
                          alignSelf: "flex-start",
                        }}
                      >
                        {showToken ? "hide" : "show"}
                      </button>
                    </div>
                  )}

                  {user?.refreshToken && (
                    <div
                      style={{
                        padding: "12px",
                        marginBottom: "8px",
                        borderRadius: "8px",
                        backgroundColor: "#0a0a0a",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "11px",
                            color: "#666",
                            marginBottom: "4px",
                          }}
                        >
                          Refresh Token
                        </div>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#fff",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: showRefreshToken ? "normal" : "nowrap",
                            filter: showRefreshToken ? "none" : "blur(44px)",
                            wordBreak: "break-all",
                          }}
                        >
                          {showRefreshToken
                            ? user.refreshToken
                            : String(user.refreshToken).length > 48
                              ? String(user.refreshToken).substring(0, 48) + "..."
                              : user.refreshToken}
                        </div>
                      </div>
                      <button
                        onClick={() => setShowRefreshToken(!showRefreshToken)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#2196F3",
                          cursor: "pointer",
                          fontSize: "12px",
                          padding: "6px 10px",
                          whiteSpace: "nowrap",
                          alignSelf: "flex-start",
                        }}
                      >
                        {showRefreshToken ? "hide" : "show"}
                      </button>
                    </div>
                  )}
                </div>
              </details>
            </div>

            {user?.refreshToken && (
              <button
                onClick={handleManualRefresh}
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: "14px",
                  cursor: "pointer",
                  backgroundColor: "#4285f4",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: 600,
                  transition: "all 0.3s",
                  marginBottom: "12px",
                }}
              >
                🔄 Refresh Token Manually
              </button>
            )}

            {/* Note: Removed the tabsData display from here, as it's in the main panel */}

            <button
              onClick={handleLogout}
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "14px",
                cursor: "pointer",
                backgroundColor: "#dc2626",
                color: "white",
                border: "none",
                borderRadius: "8px",
                fontWeight: 600,
                transition: "all 0.3s",
              }}
            >
              Logout
            </button>
            {/* == END: Full Profile Block from Plasmo == */}

          </div>
        </div>
      )}
      {/* --- END: Profile UI --- */}

      {/* --- START: Main WXT AI Assistant UI --- */}
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
      {/* --- END: Main WXT AI Assistant UI --- */}
    </div>
  );
}

export default App;