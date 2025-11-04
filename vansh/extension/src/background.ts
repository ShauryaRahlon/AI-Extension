import { Storage } from "@plasmohq/storage"
const storage = new Storage()
export interface TabInfo {
    id?: number
    url?: string
    title?: string
    favIconUrl?: string
}

export interface TabsData {
    allTabs: TabInfo[]
    activeTab: TabInfo
    totalTabs: number
    lastUpdated: string
}
export async function getAllTabsInfo(): Promise<TabsData | null> {
    try {
        const allTabs = await chrome.tabs.query({})
        const [activeTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        })
        const allTabsUrls: TabInfo[] = allTabs.map(tab => ({
            id: tab.id,
            url: tab.url,
            title: tab.title,
            favIconUrl: tab.favIconUrl
        }))
        const activeTabInfo: TabInfo = {
            id: activeTab?.id,
            url: activeTab?.url,
            title: activeTab?.title,
            favIconUrl: activeTab?.favIconUrl
        }

        return {
            allTabs: allTabsUrls,
            activeTab: activeTabInfo,
            totalTabs: allTabsUrls.length,
            lastUpdated: new Date().toISOString()
        }
    } catch (error) {
        console.error("Error fetching tabs:", error)
        return null
    }
}
export async function storeTabsInfo(): Promise<TabsData | null> {
    const tabsInfo = await getAllTabsInfo()
    if (tabsInfo) {
        await storage.set("tabsData", tabsInfo)
        await storage.set("allTabsUrls", tabsInfo.allTabs)
        await storage.set("activeTabUrl", tabsInfo.activeTab)
        await storage.set("totalTabs", tabsInfo.totalTabs)
        await storage.set("lastUpdated", tabsInfo.lastUpdated)

        console.log("Tabs info stored:", tabsInfo)
        return tabsInfo
    }

    return null
}
export async function getStoredTabsInfo(): Promise<TabsData | null> {
    const tabsData = await storage.get<TabsData>("tabsData")
    return tabsData
}
export async function getActiveTabUrl(): Promise<string | null> {
    const activeTab = await storage.get<TabInfo>("activeTabUrl")
    return activeTab?.url || null
}
export async function getAllTabsUrls(): Promise<string[]> {
    const allTabs = await storage.get<TabInfo[]>("allTabsUrls")
    return allTabs?.map(tab => tab.url).filter(url => url !== undefined) as string[] || []
}
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        storeTabsInfo()
    }
})
chrome.tabs.onActivated.addListener(() => {
    storeTabsInfo()
})
chrome.tabs.onCreated.addListener(() => {
    storeTabsInfo()
})
chrome.tabs.onRemoved.addListener(() => {
    storeTabsInfo()
})
storeTabsInfo()
console.log("Background script loaded - Tab tracking active")