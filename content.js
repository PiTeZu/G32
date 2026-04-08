// 监听用户的鼠标抬起事件，获取网页上当前被选中的文本内容，如果有内容则打印到控制台

document.addEventListener("mouseup", () => {
	const selection = window.getSelection();
	if (!selection) {
		return;
	}

	const selectedText = selection.toString().trim();
	if (selectedText) {
		chrome.runtime.sendMessage({
			action: "update_sidebar",
			text: selectedText
		});
	}
});

