// 监听用户鼠标抬起：提取选中文本与父级上下文，并发送给 background.js

document.addEventListener("mouseup", () => {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return;
	}

	const selectedText = selection.toString().trim();
	if (selectedText) {
		const anchorNode = selection.anchorNode;
		const baseElement = anchorNode
			? (anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode)
			: null;
		const contextElement = baseElement && "closest" in baseElement
			? baseElement.closest("p, div") || baseElement
			: null;
		const contextText = (contextElement?.innerText || "").trim();

		chrome.runtime.sendMessage({
			action: "update_sidebar",
			text: selectedText,
			payload: {
				selectedText,
				contextText
			}
		});
	}
});

