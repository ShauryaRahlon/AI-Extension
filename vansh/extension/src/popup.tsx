import { useEffect, useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import type { TabInfo, TabsData } from "~background"
import "./style.css"
function IndexPopup() {
  const [tabsData] = useStorage<TabsData>("tabsData")
  const [activeTabUrl] = useStorage<TabInfo>("activeTabUrl")
  const handleRefresh = async () => {
    const { storeTabsInfo } = await import("./background")
    await storeTabsInfo()
  }
  return (
    <div className="popup-container">
      <div className="header">
        <h2>🗂️ Tabs Manager</h2>
        <button onClick={handleRefresh} className="refresh-btn">
          🔄 Refresh
        </button>
      </div>
      <div className="section active-tab-section">
        <h3>📍 Active Tab</h3>
        {activeTabUrl ? (
          <div className="tab-item active">
            {activeTabUrl.favIconUrl && (
              <img
                src={activeTabUrl.favIconUrl}
                alt=""
                className="favicon"
              />
            )}
            <div className="tab-info">
              <div className="tab-title">{activeTabUrl.title || "No title"}</div>
              <div className="tab-url">{activeTabUrl.url || "No URL"}</div>
            </div>
          </div>
        ) : (
          <p>Loading active tab...</p>
        )}
      </div>
      <div className="section">
        <h3>📑 All Tabs ({tabsData?.totalTabs || 0})</h3>
        <div className="tabs-list">
          {tabsData?.allTabs && tabsData.allTabs.length > 0 ? (
            tabsData.allTabs.map((tab, index) => (
              <div key={tab.id || index} className="tab-item">
                {tab.favIconUrl && (
                  <img
                    src={tab.favIconUrl}
                    alt=""
                    className="favicon"
                  />
                )}
                <div className="tab-info">
                  <div className="tab-title">{tab.title || "No title"}</div>
                  <div className="tab-url">{tab.url || "No URL"}</div>
                </div>
              </div>
            ))
          ) : (
            <p>No tabs found...</p>
          )}
        </div>
      </div>
      <div className="footer">
        <small>
          Last updated: {tabsData?.lastUpdated
            ? new Date(tabsData.lastUpdated).toLocaleTimeString()
            : "Never"}
        </small>
      </div>
    </div>
  )
}
export default IndexPopup