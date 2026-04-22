const ERROR_MESSAGE = "处理失败，请检查网络、API Key 或稍后重试。";
const EMPTY_INPUT_MESSAGE = "请先划选一个新闻关键词。";
const STATUS_FIRST_SEARCH = "初次搜索中...";
const STATUS_AI_COMPENSATION = "快速搜索未命中，正在启动 AI 精准解析...";
const STATUS_AI_REFINING = "AI 关键词炼制中...";
const STATUS_SECOND_SEARCH = "二次精准搜索中...";
const STATUS_FINAL_SUMMARY = "最终总结生成中...";

chrome.runtime.onMessage.addListener((request) => {
	if (request?.action !== "update_sidebar") {
		return;
	}

	const selectedText = typeof request?.payload?.selectedText === "string"
		? request.payload.selectedText.trim()
		: (typeof request?.text === "string" ? request.text.trim() : "");

	void runRagFlow(selectedText);
});

async function runRagFlow(text) {
	const summaryElement = document.getElementById("summary-text");
	const newsListElement = document.getElementById("news-list");
	if (!summaryElement || !newsListElement) {
		return;
	}

	if (!text) {
		summaryElement.textContent = EMPTY_INPUT_MESSAGE;
		newsListElement.innerHTML = '<div style="color: #666;">请先划选一个新闻关键词。</div>';
		return;
	}

	try {
		const { newsApiKey = "", deepseekApiKey = "" } = await chrome.storage.local.get(["newsApiKey", "deepseekApiKey"]);
		const cleanNewsApiKey = String(newsApiKey || "").trim();
		const cleanDeepseekApiKey = String(deepseekApiKey || "").trim();

		if (!cleanDeepseekApiKey) {
			summaryElement.textContent = "未配置 DeepSeek API Key，请先在本地配置 `deepseekApiKey`。";
			newsListElement.innerHTML = '<div style="color: #666;">暂无新闻来源。</div>';
			return;
		}

		const initialKeywords = extractKeywords(text);
		const initialQuery = initialKeywords.length > 0 ? initialKeywords.join(" ") : text;

		summaryElement.textContent = STATUS_FIRST_SEARCH;
		newsListElement.innerHTML = `<div style="color: #666;">首次检索关键词：${escapeHtml(initialQuery)}</div>`;

		let queryUsed = initialQuery;
		let articles = await fetchTopNewsArticles(queryUsed, cleanNewsApiKey);

		if (articles.length === 0) {
			summaryElement.textContent = STATUS_AI_COMPENSATION;
			newsListElement.innerHTML = '<div style="color: #666;">快速搜索暂无结果，正在生成更精准关键词...</div>';

			summaryElement.textContent = STATUS_AI_REFINING;
			const refinedQuery = await refineKeywordsByAI(text, cleanDeepseekApiKey);

			if (refinedQuery) {
				queryUsed = refinedQuery;
				summaryElement.textContent = STATUS_SECOND_SEARCH;
				newsListElement.innerHTML = `<div style="color: #666;">二次检索关键词：${escapeHtml(refinedQuery)}</div>`;
				articles = await fetchTopNewsArticles(refinedQuery, cleanNewsApiKey);
			}
		}

		renderNewsList(newsListElement, articles);

		summaryElement.textContent = STATUS_FINAL_SUMMARY;
		const searchContext = buildSearchContext(articles);
		const summary = await fetchDeepSeekSummary({
			text,
			searchContext,
			queryUsed,
			deepseekApiKey: cleanDeepseekApiKey
		});

		summaryElement.textContent = summary || ERROR_MESSAGE;
	} catch (error) {
		console.error("RAG flow failed:", error);
		summaryElement.textContent = ERROR_MESSAGE;
		newsListElement.innerHTML = '<div style="color: #666;">请稍后重试。</div>';
	}
}

function extractKeywords(text) {
	const source = String(text || "").trim();
	if (!source) {
		return [];
	}

	const englishMatches = source.match(/[A-Za-z][A-Za-z'’-]{1,}/g) || [];
	const chineseMatches = source.match(/[\u4e00-\u9fa5]{2,}/g) || [];
	const merged = [...englishMatches, ...chineseMatches].map((item) => item.trim()).filter(Boolean);
	const unique = [];

	for (const keyword of merged) {
		if (!unique.includes(keyword)) {
			unique.push(keyword);
		}
		if (unique.length >= 5) {
			break;
		}
	}

	return unique;
}

async function fetchTopNewsArticles(query, newsApiKey) {
	if (!newsApiKey) {
		return [];
	}

	const endpoint = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=relevance&pageSize=5&language=en`;

	try {
		const response = await fetch(endpoint, {
			method: "GET",
			headers: {
				"X-Api-Key": newsApiKey
			}
		});

		if (!response.ok) {
			const errorBody = await response.text();
			console.error("NewsAPI request failed", {
				endpoint,
				status: response.status,
				statusText: response.statusText,
				errorBody,
				hasApiKey: Boolean(newsApiKey),
				apiKeyPrefix: newsApiKey.slice(0, 6)
			});
			return [];
		}

		const data = await response.json();
		const articles = Array.isArray(data?.articles) ? data.articles.slice(0, 5) : [];

		return articles.map((article) => ({
			title: String(article?.title || "无标题").trim(),
			description: String(article?.description || "无描述").trim(),
			sourceName: String(article?.source?.name || "未知来源").trim(),
			url: String(article?.url || "").trim()
		}));
	} catch (error) {
		console.error("NewsAPI request failed", {
			endpoint,
			error: String(error)
		});
		return [];
	}
}

async function refineKeywordsByAI(text, deepseekApiKey) {
	const response = await fetch("https://api.deepseek.com/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${deepseekApiKey}`
		},
		body: JSON.stringify({
			model: "deepseek-chat",
			temperature: 0,
			messages: [
				{
					role: "system",
					content: "你是一个搜索专家。请从用户提供的长文本中，提取出最适合在新闻搜索引擎中查找相关报道的 2-3 个核心关键词，直接输出关键词，用空格分隔，不要有任何多余文字。"
				},
				{
					role: "user",
					content: text
				}
			]
		})
	});

	if (!response.ok) {
		throw new Error(`DeepSeek refine keywords error: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	const content = data?.choices?.[0]?.message?.content?.trim() || "";
	return content.replace(/[，,、;；\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function renderNewsList(container, articles) {
	if (!Array.isArray(articles) || articles.length === 0) {
		container.innerHTML = '<div style="color: #666;">暂无相关新闻结果。</div>';
		return;
	}

	container.innerHTML = `
		<ol class="source-list">
			${articles.map((article, index) => {
				const safeTitle = escapeHtml(article.title || "无标题");
				const safeSource = escapeHtml(article.sourceName || "未知来源");
				const safeUrl = escapeAttribute(article.url || "#");

				return `
					<li>
						<div class="source-item-title">${index + 1}. ${safeTitle}</div>
						<div class="source-item-meta">来源：${safeSource}</div>
						<div><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">阅读原文</a></div>
					</li>
				`;
			}).join("")}
		</ol>
	`;
}

function buildSearchContext(articles) {
	if (!Array.isArray(articles) || articles.length === 0) {
		return "";
	}

	return articles
		.map((article, index) => {
			const title = (article?.title || "无标题").trim();
			const description = (article?.description || "无描述").trim();
			return `${index + 1}. 标题：${title}；描述：${description}`;
		})
		.join("\n");
}

async function fetchDeepSeekSummary({ text, searchContext, queryUsed, deepseekApiKey }) {
	const prompt = searchContext
		? `请根据以下关于“${text}”的新闻搜索结果生成总结。检索关键词：${queryUsed}。结果：${searchContext}。请写一段150字左右中文综合背景总结，提炼最新进展。`
		: `未检索到与“${text}”相关的新闻结果。请基于你掌握的信息写一段150字左右中文背景总结，并说明可能的最新动态。`;

	const response = await fetch("https://api.deepseek.com/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${deepseekApiKey}`
		},
		body: JSON.stringify({
			model: "deepseek-chat",
			temperature: 0.3,
			messages: [
				{
					role: "system",
					content: "你是专业新闻编辑，回答需要简明、准确、客观，并严格控制在150字左右。"
				},
				{
					role: "user",
					content: prompt
				}
			]
		})
	});

	if (!response.ok) {
		throw new Error(`DeepSeek summary error: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	return data?.choices?.[0]?.message?.content?.trim() || "";
}

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
	return escapeHtml(value);
}
