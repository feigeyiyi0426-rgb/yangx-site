const newsList = document.querySelector("#news-list");
const newsStatus = document.querySelector("#news-status");
const newsSources = document.querySelector("#news-sources");
const refreshNewsButton = document.querySelector("#refresh-news");
const NEWS_CACHE_KEY = "yangx-agriculture-news-cache-v1";
const NEWS_REQUEST_TIMEOUT_MS = 12000;

const sectorRules = [
  { label: "粮食作物", keywords: ["玉米", "大豆", "小麦", "水稻", "corn", "soybean", "soybeans", "wheat", "rice", "grain"] },
  { label: "农产品价格", keywords: ["价格", "期货", "库存", "产量", "出口", "收成", "markets", "prices", "futures", "export", "harvest", "yield"] },
  { label: "化肥农资", keywords: ["化肥", "肥料", "农药", "种子", "fertilizer", "fertiliser", "pesticide", "seed", "input"] },
  { label: "畜牧养殖", keywords: ["牛", "猪", "鸡", "乳制品", "肉类", "livestock", "cattle", "hog", "pork", "beef", "dairy", "poultry"] },
  { label: "农业科技", keywords: ["农业科技", "精准农业", "无人机", "灌溉", "agtech", "technology", "precision", "drone", "irrigation"] },
  { label: "气候天气", keywords: ["干旱", "洪水", "天气", "气候", "drought", "flood", "weather", "climate", "rain"] },
  { label: "粮食安全", keywords: ["粮食安全", "饥饿", "援助", "food security", "hunger", "aid", "FAO"] },
  { label: "加密市场", keywords: ["比特币", "以太坊", "加密", "Bitcoin", "BTC", "Ethereum", "ETH", "crypto"] },
  { label: "ETF/机构", keywords: ["ETF", "BlackRock", "Fidelity", "Grayscale", "institutional", "fund", "基金", "机构"] },
  { label: "交易所", keywords: ["exchange", "Binance", "Coinbase", "OKX", "Kraken", "交易所", "listing", "上币"] },
  { label: "安全风控", keywords: ["hack", "exploit", "scam", "phishing", "breach", "黑客", "攻击", "漏洞", "诈骗"] },
  { label: "政策监管", keywords: ["政府", "总统", "国会", "法院", "监管", "政策", "边境", "制裁", "关税", "SEC", "CFTC"] },
  { label: "能源油气", keywords: ["石油", "油价", "天然气", "能源", "海湾", "伊朗", "封锁", "油轮"] },
  { label: "航运物流", keywords: ["航运", "船只", "港口", "海峡", "货船", "供应链", "运输"] },
];

function createTextNode(tag, text, className) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  node.textContent = text;
  return node;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function setNewsStatus(message, isError = false) {
  newsStatus.textContent = message;
  newsStatus.classList.toggle("is-error", isError);
}

function readCachedNews() {
  try {
    return JSON.parse(localStorage.getItem(NEWS_CACHE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveCachedNews(payload) {
  try {
    localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // 缓存失败不影响新闻显示。
  }
}

async function fetchNewsPayload() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("/api/news", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("news request failed");
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function getSectorNote(item) {
  const text = `${item.category || ""} ${item.source || ""} ${item.title || ""} ${item.summary || ""} ${
    item.originalTitle || ""
  } ${item.originalSummary || ""}`;

  const matched = sectorRules
    .filter((rule) => rule.keywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase())))
    .map((rule) => rule.label);

  const sectors = [...new Set(matched)].slice(0, 4);
  return sectors.length ? `影响：${sectors.join("、")}` : "影响：农业产业链、相关市场情绪";
}

function renderSources(sources = []) {
  if (!newsSources) {
    return;
  }

  newsSources.innerHTML = "";
  sources.slice(0, 8).forEach((source) => {
    const link = document.createElement("a");
    link.href = source.homepage;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.name;
    newsSources.appendChild(link);
  });
}

function renderNews(items, updatedAt) {
  newsList.innerHTML = "";

  if (!items.length) {
    newsList.appendChild(createTextNode("p", "暂时没有读取到农业新闻，请稍后刷新。", "news-empty"));
    return;
  }

  items.forEach((item) => {
    const article = document.createElement("article");
    article.className = "news-item";

    const meta = document.createElement("div");
    meta.className = "news-meta";
    meta.append(
      createTextNode("span", item.source || "新闻来源"),
      createTextNode("span", item.category || "农业", "news-category")
    );

    const time = document.createElement("time");
    time.dateTime = item.publishedAt;
    time.textContent = formatDate(item.publishedAt);
    meta.appendChild(time);

    const link = document.createElement("a");
    link.className = "news-source-link";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "查看来源";

    article.append(
      meta,
      createTextNode("h3", item.title),
      createTextNode("p", item.summary, "news-summary"),
      createTextNode("p", getSectorNote(item), "news-sector"),
      link
    );
    newsList.appendChild(article);
  });

  setNewsStatus(`已更新：${formatDate(updatedAt)}。农业新闻为主，币圈新闻少量保留。`);
}

async function loadNews() {
  refreshNewsButton.disabled = true;
  setNewsStatus("正在读取农业新闻...");

  const cached = readCachedNews();
  if (cached?.items?.length) {
    renderSources(cached.sources || []);
    renderNews(cached.items, cached.updatedAt || new Date().toISOString());
    setNewsStatus("先显示上次农业新闻，正在更新最新内容...");
  }

  try {
    const payload = await fetchNewsPayload();
    saveCachedNews(payload);
    renderSources(payload.sources || []);
    renderNews(payload.items || [], payload.updatedAt || new Date().toISOString());
  } catch {
    if (cached?.items?.length) {
      setNewsStatus("最新农业新闻暂时读取较慢，已保留上次结果。", true);
      return;
    }

    setNewsStatus("农业新闻读取失败，请稍后再试。", true);
    newsList.innerHTML = "";
    newsList.appendChild(createTextNode("p", "暂时无法连接新闻源。", "news-empty"));
  } finally {
    refreshNewsButton.disabled = false;
  }
}

refreshNewsButton.addEventListener("click", loadNews);
loadNews();
