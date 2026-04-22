// 允许用户点击插件图标时自动打开侧边栏
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

// 只转发来自页面 content script 的消息，避免 service worker 自触发循环
chrome.runtime.onMessage.addListener((message, sender) => {
	if (message?.action !== "update_sidebar") {
		return;
	}

	if (!sender.tab) {
		return;
	}

	chrome.runtime.sendMessage(message).catch((error) => {
		console.error("Failed to forward message to sidebar:", error);
	});
});