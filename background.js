const enable = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.runtime.onInstalled.addListener(enable);
chrome.runtime.onStartup.addListener(enable);
enable();
