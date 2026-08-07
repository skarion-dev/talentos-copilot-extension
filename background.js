const enable = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.runtime.onInstalled.addListener(enable);
chrome.runtime.onStartup.addListener(enable);
enable();

// Preserve submit signals even when the side panel is closed. The panel
// consumes this queue on its next open, using the user's configured API key.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action !== 'applicationSubmittedDetected' || !sender.tab?.id) return;
  chrome.storage.local.set({ pendingApplicationStatus: {
    applicationId: (() => { try { return new URL(sender.tab.url || '').hash.match(/talentos_application_id=([^&]+)/)?.[1] || ''; } catch { return ''; } })(),
    tabId: sender.tab.id,
  } });
});
