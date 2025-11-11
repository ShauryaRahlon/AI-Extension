import { useEffect, useState } from "react"
import { Storage } from "@plasmohq/storage"
import { X, RefreshCw } from "lucide-react"

const storage = new Storage()

interface TabInfo {
    id?: number
    url?: string
    title?: string
    favIconUrl?: string
}

interface TabsData {
    allTabs: TabInfo[]
    activeTab: TabInfo
    totalTabs: number
    lastUpdated: string
}

// Safe references to global extension APIs
const globalWindow: any = window
const globalChrome = globalWindow.chrome
const globalBrowser = globalWindow.browser

// Backend service URL
const BACKEND_URL = "http://localhost:5000"

// Browser detection utility
const getBrowserInfo = () => {
    const ua = navigator.userAgent || ""
    const hasBrowserApi = typeof globalBrowser !== "undefined" && !!globalBrowser
    const isFirefox = hasBrowserApi && ua.includes("Firefox")
    const isChrome = !isFirefox && ua.includes("Chrome")
    let name = "Unknown"
    if (isFirefox) name = "Firefox"
    else if (ua.includes("Edg")) name = "Edge"
    else if (isChrome) name = "Chrome"
    return { name, isFirefox, isChrome }
}

function SidePanel() {
    const [user, setUser] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [tabsData, setTabsData] = useState<TabsData | null>(null)
    const [showProfile, setShowProfile] = useState(false)
    const [showToken, setShowToken] = useState(false)
    const [showRefreshToken, setShowRefreshToken] = useState(false)
    const [tokenStatus, setTokenStatus] = useState<string>("")
    const browserInfo = getBrowserInfo()

    useEffect(() => {
        const init = async () => {
            const rawSavedUser = await storage.get("googleUser")
            let savedUser: any = null

            if (rawSavedUser) {
                if (typeof rawSavedUser === "string") {
                    try {
                        savedUser = JSON.parse(rawSavedUser)
                    } catch {
                        savedUser = rawSavedUser
                    }
                } else {
                    savedUser = rawSavedUser
                }
            }

            if (savedUser && typeof savedUser === "object") {
                await checkAndRefreshToken(savedUser)
                setLoading(false)
                await loadTabsData()
            } else {
                setLoading(false)
            }
        }
        init()

        const handleStorageChange = (changes: any) => {
            if (changes.tabsData?.newValue) {
                setTabsData(changes.tabsData.newValue)
            }
            if (changes.googleUser?.newValue) {
                setUser(changes.googleUser.newValue)
            }
        }

        storage.watch({
            tabsData: handleStorageChange,
            googleUser: handleStorageChange
        })
    }, [])

    const refreshAccessToken = async (refreshToken: string) => {
        try {
            const response = await fetch(`${BACKEND_URL}/refresh-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    refresh_token: refreshToken
                })
            })

            if (!response.ok) {
                throw new Error('Failed to refresh token')
            }

            const data = await response.json()
            return {
                accessToken: data.access_token,
                expiresIn: data.expires_in || 3600
            }
        } catch (error) {
            console.error('Error refreshing token:', error)
            return null
        }
    }

    const checkAndRefreshToken = async (userData: any) => {
        const tokenAge = userData.tokenTimestamp 
            ? Date.now() - userData.tokenTimestamp 
            : Infinity
        
        // If token is older than 55 minutes and we have a refresh token, refresh it
        if (tokenAge > 3300000 && userData.refreshToken) {
            setTokenStatus("🔄 Refreshing token...")
            
            const refreshResult = await refreshAccessToken(userData.refreshToken)

            if (refreshResult) {
                const updatedUserData = {
                    ...userData,
                    token: refreshResult.accessToken,
                    tokenTimestamp: Date.now(),
                    tokenExpiresIn: refreshResult.expiresIn
                }
                await storage.set("googleUser", updatedUserData)
                setUser(updatedUserData)
                setTokenStatus("✅ Token refreshed successfully")
                return
            } else {
                setTokenStatus("⚠️ Failed to refresh token - please re-authenticate")
                setUser(userData)
                return
            }
        }
        
        // Token is still valid or we can't refresh it
        if (tokenAge > 3600000 && !userData.refreshToken) {
            setTokenStatus("❌ Token expired - please re-authenticate")
        } else if (userData.refreshToken) {
            setTokenStatus("✅ Token valid (with auto-refresh)")
        } else {
            setTokenStatus("⚠️ Token valid (no refresh token - will expire)")
        }
        setUser(userData)
    }

    const handleChromeLogin = async () => {
        try {
            const identityApi = globalChrome?.identity
            if (!identityApi) throw new Error("chrome.identity API not available")

            const redirectUri = identityApi.getRedirectURL()
            const clientId = "95116700360-13ege5jmfrjjt4vmd86oh00eu5jlei5e.apps.googleusercontent.com"
            const scopes = "openid email profile https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/gmail.readonly"
            
            // CHANGED: Use authorization code flow instead of implicit flow
            const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(
                redirectUri
            )}&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`

            const redirectResponse = await identityApi.launchWebAuthFlow({
                url: authUrl,
                interactive: true
            })

            // CHANGED: Extract authorization code instead of access token
            const codeMatch = redirectResponse?.match(/code=([^&]+)/)
            const code = codeMatch ? codeMatch[1] : null

            if (!code) throw new Error("No authorization code found in response")

            // CHANGED: Exchange code for tokens via backend
            const tokenResponse = await fetch(`${BACKEND_URL}/exchange-code`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    code: code,
                    redirect_uri: redirectUri
                })
            })

            if (!tokenResponse.ok) {
                const errorData = await tokenResponse.json()
                throw new Error(`Token exchange failed: ${errorData.error}`)
            }

            const tokenData = await tokenResponse.json()
            const token = tokenData.access_token
            const refreshToken = tokenData.refresh_token
            const expiresIn = tokenData.expires_in || 3600

            const userInfo = await fetch(
                `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${token}`
            ).then((res) => res.json())

            const fullUserData = {
                ...userInfo,
                token,
                refreshToken, // ADDED: Store refresh token
                tokenTimestamp: Date.now(),
                tokenExpiresIn: expiresIn,
                redirectUri,
                loginTime: new Date().toISOString(),
                browser: browserInfo.name
            }
            await storage.set("googleUser", fullUserData)
            setUser(fullUserData)
            setTokenStatus("✅ Token valid (with auto-refresh)")
            await loadTabsData()
        } catch (err: any) {
            console.error("Chrome Auth Error:", err)
            if (String(err).toLowerCase().includes("user cancelled") || String(err).toLowerCase().includes("denied")) {
                alert("Authentication cancelled. Please allow access in the popup to sign in.")
            } else {
                alert(`Authentication failed: ${err.message}\n\nMake sure backend service is running:\npython backend_service.py`)
            }
        }
    }

    const handleFirefoxLogin = async () => {
        try {
            const identityApi = globalBrowser?.identity || globalChrome?.identity
            if (!identityApi) throw new Error("identity API not available")

            const redirectUri = identityApi.getRedirectURL?.() || `https://${globalChrome?.runtime?.id}.chromiumapp.org/`
            const clientId = "95116700360-13ege5jmfrjjt4vmd86oh00eu5jlei5e.apps.googleusercontent.com"
            const scopes = "openid email profile https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/gmail.readonly"
            
            const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(
                redirectUri
            )}&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`

            const redirectResponse = await identityApi.launchWebAuthFlow({
                url: authUrl,
                interactive: true
            })

            const codeMatch = redirectResponse?.match(/code=([^&]+)/)
            const code = codeMatch ? codeMatch[1] : null

            if (!code) throw new Error("No authorization code found in response")

            const tokenResponse = await fetch(`${BACKEND_URL}/exchange-code`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    code: code,
                    redirect_uri: redirectUri
                })
            })

            if (!tokenResponse.ok) {
                const errorData = await tokenResponse.json()
                throw new Error(`Token exchange failed: ${errorData.error}`)
            }

            const tokenData = await tokenResponse.json()
            const token = tokenData.access_token
            const refreshToken = tokenData.refresh_token
            const expiresIn = tokenData.expires_in || 3600

            const userInfo = await fetch(
                `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${token}`
            ).then((res) => res.json())

            const fullUserData = {
                ...userInfo,
                token,
                refreshToken,
                tokenTimestamp: Date.now(),
                tokenExpiresIn: expiresIn,
                redirectUri,
                loginTime: new Date().toISOString(),
                browser: browserInfo.name
            }
            await storage.set("googleUser", fullUserData)
            setUser(fullUserData)
            setTokenStatus("✅ Token valid (with auto-refresh)")
            await loadTabsData()
        } catch (err: any) {
            console.error("Firefox Auth Error:", err)
            if (String(err).toLowerCase().includes("user cancelled") || String(err).toLowerCase().includes("denied")) {
                alert("Authentication cancelled. Please allow access in the popup to sign in.")
            } else {
                alert(`Authentication failed: ${err.message}`)
            }
        }
    }

    const handleLogin = async () => {
        setLoading(true)
        try {
            if (browserInfo.isChrome) {
                await handleChromeLogin()
            } else if (browserInfo.isFirefox) {
                await handleFirefoxLogin()
            } else {
                alert("Unsupported browser")
            }
        } finally {
            setLoading(false)
        }
    }

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
            await storage.set("googleUser", updatedUserData)
            setUser(updatedUserData)
            setTokenStatus("✅ Token refreshed successfully")
        } else {
            setTokenStatus("❌ Failed to refresh token")
            alert("Failed to refresh token. Please re-authenticate.")
        }
    }

    const loadTabsData = async () => {
        try {
            const storedTabsData = await storage.get<TabsData>("tabsData")
            if (storedTabsData) {
                setTabsData(storedTabsData)
            } else {
                const tabsApi = globalChrome?.tabs || globalBrowser?.tabs
                if (!tabsApi || !tabsApi.query) return

                const queryTabs = (opts: any) =>
                    new Promise<any[]>((resolve) => {
                        const res = tabsApi.query(opts, (r: any) => {
                            if (r !== undefined) resolve(r)
                        })
                        if (res && typeof res.then === "function") {
                            res.then((r: any) => resolve(r))
                        }
                    })

                const allTabs = await queryTabs({})
                const activeTabs = await queryTabs({
                    active: true,
                    currentWindow: true
                })
                const activeTab = activeTabs[0]

                const allTabsInfo: TabInfo[] = allTabs.map((tab: any) => ({
                    id: tab.id,
                    url: tab.url,
                    title: tab.title,
                    favIconUrl: tab.favIconUrl
                }))

                const data: TabsData = {
                    allTabs: allTabsInfo,
                    activeTab: {
                        id: activeTab?.id,
                        url: activeTab?.url,
                        title: activeTab?.title,
                        favIconUrl: activeTab?.favIconUrl
                    },
                    totalTabs: allTabsInfo.length,
                    lastUpdated: new Date().toISOString()
                }
                setTabsData(data)
            }
        } catch (error) {
            console.error("Error loading tabs:", error)
        }
    }

    const handleLogout = async () => {
        await storage.remove("googleUser")
        setUser(null)
        setTabsData(null)
        setShowProfile(false)
        setTokenStatus("")
    }

    const getTokenAge = () => {
        if (!user?.tokenTimestamp) return "Unknown"
        const ageMs = Date.now() - user.tokenTimestamp
        const ageMinutes = Math.floor(ageMs / 60000)
        const ageHours = Math.floor(ageMinutes / 60)
        const remainingMinutes = ageMinutes % 60
        
        if (ageHours > 0) {
            return `${ageHours}h ${remainingMinutes}m`
        }
        return `${ageMinutes}m`
    }

    const getTokenExpiry = () => {
        if (!user?.tokenTimestamp || !user?.tokenExpiresIn) return "Unknown"
        const expiryTime = new Date(user.tokenTimestamp + (user.tokenExpiresIn * 1000))
        const now = new Date()
        const remainingMs = expiryTime.getTime() - now.getTime()
        
        if (remainingMs <= 0) return "Expired"
        
        const remainingMinutes = Math.floor(remainingMs / 60000)
        return `${remainingMinutes} minutes`
    }

    if (loading) {
        return (
            <div style={{
                padding: 20,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100vh",
                backgroundColor: "#0a0a0a",
                color: "#fff",
                fontFamily: "sans-serif"
            }}>
                <div>⏳ Loading...</div>
            </div>
        )
    }

    if (!user) {
        return (
            <div style={{
                padding: 20,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                height: "100vh",
                backgroundColor: "#0a0a0a",
                fontFamily: "sans-serif",
                textAlign: "center"
            }}>
                <div style={{
                    backgroundColor: "#1a1a1a",
                    padding: "40px",
                    borderRadius: "16px",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                    maxWidth: "400px"
                }}>
                    <h2 style={{
                        marginBottom: 16,
                        color: "#fff",
                        fontSize: "24px",
                        fontWeight: "600"
                    }}>
                        🤖 AI Assistant
                    </h2>
                    <p style={{
                        color: "#999",
                        marginBottom: 24,
                        fontSize: 14,
                        lineHeight: "1.5"
                    }}>
                        Sign in with Google to view your profile and browser info
                    </p>
                    <p style={{
                        color: "#666",
                        marginBottom: 24,
                        fontSize: 12
                    }}>
                        Browser: {browserInfo.name}
                    </p>
                    <button
                        onClick={handleLogin}
                        style={{
                            padding: "14px 32px",
                            fontSize: 16,
                            backgroundColor: "#4285f4",
                            color: "white",
                            border: "none",
                            borderRadius: "8px",
                            cursor: "pointer",
                            fontWeight: 600,
                            transition: "all 0.3s",
                            boxShadow: "0 4px 12px rgba(66, 133, 244, 0.3)"
                        }}
                    >
                        Sign in with Google
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div style={{
            height: "100vh",
            backgroundColor: "#0a0a0a",
            display: "flex",
            flexDirection: "column",
            fontFamily: "sans-serif",
            position: "relative"
        }}>
            {/* Header */}
            <div style={{
                padding: "16px 20px",
                backgroundColor: "#1a1a1a",
                borderBottom: "1px solid #2a2a2a",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "18px"
                    }}>
                        🤖
                    </div>
                    <div>
                        <h3 style={{ margin: 0, color: "#fff", fontSize: "16px" }}>AI Assistant</h3>
                        <p style={{ margin: 0, color: "#666", fontSize: "11px" }}>Profile & browser info</p>
                    </div>
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
                        transition: "all 0.3s"
                    }}
                >
                    <img
                        src={user.picture}
                        alt="profile"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                </button>
            </div>

            {/* Profile Sidebar */}
            {showProfile && (
                <div style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    width: "360px",
                    height: "100%",
                    backgroundColor: "#1a1a1a",
                    borderLeft: "1px solid #2a2a2a",
                    zIndex: 1000,
                    overflowY: "auto",
                    boxShadow: "-4px 0 24px rgba(0,0,0,0.5)"
                }}>
                    <div style={{ padding: "20px" }}>
                        <div style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "24px"
                        }}>
                            <h3 style={{ margin: 0, color: "#fff", fontSize: "18px" }}>Profile</h3>
                            <button
                                onClick={() => setShowProfile(false)}
                                style={{
                                    background: "none",
                                    border: "none",
                                    color: "#999",
                                    cursor: "pointer",
                                    padding: "4px",
                                    display: "flex",
                                    alignItems: "center"
                                }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{
                            textAlign: "center",
                            marginBottom: "24px",
                            padding: "20px",
                            backgroundColor: "#0a0a0a",
                            borderRadius: "12px"
                        }}>
                            <img
                                src={user.picture}
                                alt="profile"
                                style={{
                                    width: "80px",
                                    height: "80px",
                                    borderRadius: "50%",
                                    border: "3px solid #4285f4",
                                    marginBottom: "12px"
                                }}
                            />
                            <h4 style={{ margin: "0 0 4px 0", color: "#fff" }}>{user.name}</h4>
                            <p style={{ margin: 0, fontSize: "13px", color: "#999" }}>{user.email}</p>
                        </div>

                        <div style={{ marginBottom: "16px" }}>
                            <div style={{ padding: "12px", marginBottom: "8px", borderRadius: "8px", backgroundColor: "#0a0a0a" }}>
                                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>User ID</div>
                                <div style={{ fontSize: "12px", color: "#fff" }}>{user.id}</div>
                            </div>
                            <div style={{ padding: "12px", marginBottom: "8px", borderRadius: "8px", backgroundColor: "#0a0a0a" }}>
                                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>Verified Email</div>
                                <div style={{ fontSize: "12px", color: "#fff" }}>{user.verified_email ? "✅ Yes" : "❌ No"}</div>
                            </div>
                            <div style={{ padding: "12px", marginBottom: "8px", borderRadius: "8px", backgroundColor: "#0a0a0a" }}>
                                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>Browser</div>
                                <div style={{ fontSize: "12px", color: "#fff" }}>{browserInfo.name}</div>
                            </div>
                            <div style={{ padding: "12px", marginBottom: "8px", borderRadius: "8px", backgroundColor: "#0a0a0a" }}>
                                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>Login Time</div>
                                <div style={{ fontSize: "12px", color: "#fff" }}>{new Date(user.loginTime).toLocaleString()}</div>
                            </div>

                            <details style={{ marginTop: "12px" }} open>
                                <summary style={{
                                    cursor: "pointer",
                                    padding: "8px 12px",
                                    backgroundColor: "#0a0a0a",
                                    borderRadius: "6px",
                                    fontSize: "12px",
                                    color: "#999",
                                    userSelect: "none"
                                }}>
                                    🔐 Advanced Details
                                </summary>
                                <div style={{ marginTop: "8px" }}>
                                    <div style={{ padding: "12px", marginBottom: "8px", borderRadius: "8px", backgroundColor: "#0a0a0a", wordBreak: "break-word" }}>
                                        <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>Picture URL</div>
                                        <div style={{ fontSize: "12px", color: "#fff" }}>{user.picture}</div>
                                    </div>
                                    <div style={{ padding: "12px", marginBottom: "8px", borderRadius: "8px", backgroundColor: "#0a0a0a", wordBreak: "break-word" }}>
                                        <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>Redirect URI</div>
                                        <div style={{ fontSize: "12px", color: "#fff" }}>{user.redirectUri}</div>
                                    </div>

                                    {user?.tokenTimestamp && (
                                        <>
                                            <div style={{ padding: "12px", marginBottom: "8px", borderRadius: "8px", backgroundColor: "#0a0a0a" }}>
                                                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>Token Age</div>
                                                <div style={{ fontSize: "12px", color: "#fff" }}>{getTokenAge()}</div>
                                            </div>
                                            <div style={{ padding: "12px", marginBottom: "8px", borderRadius: "8px", backgroundColor: "#0a0a0a" }}>
                                                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>Token Expires In</div>
                                                <div style={{ fontSize: "12px", color: getTokenExpiry() === "Expired" ? "#dc2626" : "#fff" }}>
                                                    {getTokenExpiry()}
                                                </div>
                                            </div>
                                            {user?.refreshToken && (
                                                <div style={{ padding: "12px", marginBottom: "8px", borderRadius: "8px", backgroundColor: "#0a0a0a" }}>
                                                    <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>Has Refresh Token</div>
                                                    <div style={{ fontSize: "12px", color: "#4ade80" }}>✅ Yes (auto-refresh enabled)</div>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {user?.token && (
                                        <div style={{
                                            padding: "12px",
                                            marginBottom: "8px",
                                            borderRadius: "8px",
                                            backgroundColor: "#0a0a0a",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px"
                                        }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>Access Token</div>
                                                <div
                                                    style={{
                                                        fontSize: "12px",
                                                        color: "#fff",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: showToken ? "normal" : "nowrap",
                                                        filter: showToken ? "none" : "blur(4px)",
                                                        wordBreak: "break-all"
                                                    }}
                                                >
                                                    {showToken ? user.token : (String(user.token).length > 48 ? String(user.token).substring(0, 48) + "..." : user.token)}
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
                                                    alignSelf: "flex-start"
                                                }}
                                            >
                                                {showToken ? "hide" : "show"}
                                            </button>
                                        </div>
                                    )}

                                    {user?.refreshToken && (
                                        <div style={{
                                            padding: "12px",
                                            marginBottom: "8px",
                                            borderRadius: "8px",
                                            backgroundColor: "#0a0a0a",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px"
                                        }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: "11px", color: "#666", marginBottom: "4px" }}>Refresh Token</div>
                                                <div
                                                    style={{
                                                        fontSize: "12px",
                                                        color: "#fff",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: showRefreshToken ? "normal" : "nowrap",
                                                        filter: showRefreshToken ? "none" : "blur(4px)",
                                                        wordBreak: "break-all"
                                                    }}
                                                >
                                                    {showRefreshToken ? user.refreshToken : (String(user.refreshToken).length > 48 ? String(user.refreshToken).substring(0, 48) + "..." : user.refreshToken)}
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
                                                    alignSelf: "flex-start"
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
                                    marginBottom: "12px"
                                }}
                            >
                                🔄 Refresh Token Manually
                            </button>
                        )}

                        {tabsData && (
                            <div style={{
                                padding: "16px",
                                backgroundColor: "#0a0a0a",
                                borderRadius: "8px",
                                marginBottom: "16px"
                            }}>
                                <div style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    marginBottom: "12px"
                                }}>
                                    <h4 style={{ margin: 0, color: "#fff", fontSize: "14px" }}>
                                        Tabs: {tabsData.totalTabs}
                                    </h4>
                                    <button
                                        onClick={loadTabsData}
                                        style={{
                                            background: "none",
                                            border: "none",
                                            color: "#4285f4",
                                            cursor: "pointer",
                                            padding: "4px",
                                            display: "flex"
                                        }}
                                    >
                                        <RefreshCw size={14} />
                                    </button>
                                </div>
                                <p style={{
                                    margin: 0,
                                    fontSize: "12px",
                                    color: "#999",
                                    wordBreak: "break-word"
                                }}>
                                    Active: {tabsData.activeTab.title}
                                </p>
                            </div>
                        )}

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
                                transition: "all 0.3s"
                            }}
                        >
                            Logout
                        </button>
                    </div>
                </div>
            )}

            {/* Main content when signed in */}
            <div style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                padding: "20px"
            }}>
                <div style={{
                    maxWidth: 640,
                    width: "100%",
                    backgroundColor: "#0f0f0f",
                    borderRadius: "12px",
                    padding: "24px",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
                }}>
                    <h2 style={{ marginTop: 0, color: "#fff" }}>Welcome, {user.given_name || user.name} 👋</h2>
                    <p style={{ color: "#bbb" }}>
                        Your profile and browser details are available in the sidebar. Use the profile button (top-right) to open it.
                    </p>

                    {tokenStatus && (
                        <div style={{
                            marginTop: 16,
                            padding: "12px",
                            backgroundColor: tokenStatus.includes("expired") || tokenStatus.includes("Failed") ? "#7f1d1d" : "#065f46",
                            borderRadius: "8px",
                            fontSize: "13px",
                            color: "#fff"
                        }}>
                            {tokenStatus}
                        </div>
                    )}

                    {tabsData && (
                        <div style={{ marginTop: 16, color: "#ddd" }}>
                            <strong>Active tab:</strong> {tabsData.activeTab.title || tabsData.activeTab.url}
                            <div style={{ marginTop: 8, fontSize: 13, color: "#999" }}>
                                Total open tabs: {tabsData.totalTabs}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default SidePanel