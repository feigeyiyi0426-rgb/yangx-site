const newsList = document.querySelector("#news-list");
const newsStatus = document.querySelector("#news-status");
const refreshNewsButton = document.querySelector("#refresh-news");
const NEWS_CACHE_KEY = "yangx-crypto-news-cache-v1";
const NEWS_REQUEST_TIMEOUT_MS = 12000;

const sectorRules = [
  { label: "比特币", keywords: ["Bitcoin", "BTC", "比特币", "satoshi", "halving", "减半"] },
  { label: "以太坊", keywords: ["Ethereum", "ETH", "以太坊", "Vitalik", "staking", "质押"] },
  { label: "主流币", keywords: ["Solana", "SOL", "XRP", "BNB", "Cardano", "ADA", "Dogecoin", "DOGE", "主流币"] },
  { label: "稳定币", keywords: ["stablecoin", "USDT", "USDC", "Tether", "Circle", "稳定币"] },
  { label: "DeFi", keywords: ["DeFi", "DEX", "lending", "liquidity", "yield", "去中心化金融", "流动性"] },
  { label: "ETF/机构", keywords: ["ETF", "BlackRock", "Fidelity", "Grayscale", "institutional", "fund", "基金", "机构"] },
  { label: "交易所", keywords: ["exchange", "Binance", "Coinbase", "OKX", "Kraken", "交易所", "listing", "上币"] },
  { label: "矿业", keywords: ["miner", "mining", "hashrate", "矿工", "挖矿", "算力", "矿业"] },
  { label: "链上/公链", keywords: ["blockchain", "Layer 2", "L2", "mainnet", "testnet", "wallet", "链上", "公链", "钱包"] },
  { label: "安全风控", keywords: ["hack", "exploit", "scam", "phishing", "breach", "黑客", "攻击", "漏洞", "诈骗"] },
  { label: "政策监管", keywords: ["SEC", "CFTC", "regulation", "lawsuit", "court", "ban", "监管", "法院", "诉讼", "合规"] },
  { label: "股市情绪", keywords: ["Nasdaq", "S&P", "stock", "shares", "Fed", "rate", "通胀", "降息", "美联储", "股市"] },
  { label: "AI/芯片", keywords: ["AI", "Nvidia", "GPU", "人工智能", "英伟达", "芯片", "半导体", "数据中心"] },
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
  return sectors.length ? `影响：${sectors.join("、")}` : "影响：币圈情绪、风险偏好";
}

function renderNews(items, updatedAt) {
  newsList.innerHTML = "";

  if (!items.length) {
    newsList.appendChild(createTextNode("p", "暂时没有读取到币圈资讯，请稍后刷新。", "news-empty"));
    return;
  }

  items.forEach((item) => {
    const article = document.createElement("article");
    article.className = "news-item";

    const meta = document.createElement("div");
    meta.className = "news-meta";
    meta.append(
      createTextNode("span", item.source || "币圈来源"),
      createTextNode("span", item.category || "币圈快讯", "news-category")
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

  setNewsStatus(`已更新：${formatDate(updatedAt)}。显示 CoinDesk / Cointelegraph 币圈资讯。`);
}

async function loadNews() {
  refreshNewsButton.disabled = true;
  setNewsStatus("正在读取币圈快讯...");

  const cached = readCachedNews();
  if (cached?.items?.length) {
    renderNews(cached.items, cached.updatedAt || new Date().toISOString());
    setNewsStatus("先显示上次币圈快讯，正在更新最新内容...");
  }

  try {
    const payload = await fetchNewsPayload();
    saveCachedNews(payload);
    renderNews(payload.items || [], payload.updatedAt || new Date().toISOString());
  } catch {
    if (cached?.items?.length) {
      setNewsStatus("最新币圈资讯暂时读取较慢，已保留上次结果。", true);
      return;
    }

    setNewsStatus("币圈资讯读取失败，请稍后再试。", true);
    newsList.innerHTML = "";
    newsList.appendChild(createTextNode("p", "暂时无法连接币圈资讯源。", "news-empty"));
  } finally {
    refreshNewsButton.disabled = false;
  }
}

refreshNewsButton.addEventListener("click", loadNews);
loadNews();
