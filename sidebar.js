const TOO_LONG_MESSAGE = "划选内容过长！请仅划选专有名词（如人名、地名、机构名）以获取精准背景。";
const LOADING_MESSAGE = "正在检索维基百科真实数据...";
const NOT_FOUND_MESSAGE = "未找到相关词条。新闻中的人物或事件可能过于冷门，或尝试换一个更准确的词汇划选。";

chrome.runtime.onMessage.addListener((message) => {
	if (!message || message.action !== "update_sidebar") {
		return;
	}

	const contentElement = document.getElementById("context-content");
	if (!contentElement) {
		return;
	}

	const text = typeof message.text === "string" ? message.text.trim() : "";
	if (text.length > 35) {
		contentElement.textContent = TOO_LONG_MESSAGE;
		return;
	}

	contentElement.textContent = LOADING_MESSAGE;

	fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(text)}`)
		.then((response) => {
			if (response.status === 404 || !response.ok) {
				throw new Error("Not found");
			}
			return response.json();
		})
		.then((data) => {
			if (data && data.extract) {
				contentElement.textContent = data.extract;
				return;
			}
			contentElement.textContent = NOT_FOUND_MESSAGE;
		})
		.catch(() => {
			contentElement.textContent = NOT_FOUND_MESSAGE;
		});
});
