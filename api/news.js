const SOURCES = [
  {
    name: "BBC",
    category: "国际",
    homepage: "https://www.bbc.com/news/world",
    feed: "https://feeds.bbci.co.uk/news/world/rss.xml",
    type: "rss",
  },
  {
    name: "BBC 财经",
    category: "财经",
    homepage: "https://www.bbc.com/news/business",
    feed: "https://feeds.bbci.co.uk/news/business/rss.xml",
    type: "rss",
  },
  {
    name: "The Guardian",
    category: "国际",
    homepage: "https://www.theguardian.com/world",
    feed: "https://www.theguardian.com/world/rss",
    type: "rss",
  },
  {
    name: "Guardian 财经",
    category: "财经",
    homepage: "https://www.theguardian.com/business",
    feed: "https://www.theguardian.com/business/rss",
    type: "rss",
  },
  {
    name: "Reuters",
    category: "国际",
    homepage: "https://www.reuters.com/world/",
    feed: "https://www.reuters.com/world/",
    type: "page",
    enabled: false,
  },
  {
    name: "AP News",
    category: "国际",
    homepage: "https://apnews.com/hub/world-news",
    feed: "https://apnews.com/hub/world-news",
    type: "page",
  },
  {
    name: "AP 财经",
    category: "财经",
    homepage: "https://apnews.com/hub/business",
    feed: "https://apnews.com/hub/business",
    type: "page",
  },
  {
    name: "Defense News",
    category: "军事",
    homepage: "https://www.defensenews.com/global/",
    feed: "https://www.defensenews.com/arc/outboundfeeds/rss/category/global/?outputType=xml",
    type: "rss",
  },
  {
    name: "Defense News Pentagon",
    category: "军事",
    homepage: "https://www.defensenews.com/pentagon/",
    feed: "https://www.defensenews.com/arc/outboundfeeds/rss/category/pentagon/?outputType=xml",
    type: "rss",
  },
];

const USER_AGENT = "YANGX News Module/1.0 (+https://www.yangx.xyz)";
const TRANSLATE_ENDPOINT = "https://api.mymemory.translated.net/get";

function decodeHtml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function stripTags(value = "") {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textBetween(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return stripTags(match?.[1] || "");
}

function linkFromItem(block) {
  const linkText = textBetween(block, "link");
  if (linkText) {
    return linkText;
  }

  const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  return decodeHtml(hrefMatch?.[1] || "");
}

function normalizeDate(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function summarize(value) {
  const clean = stripTags(value);
  if (!clean) {
    return "新闻线索来自原始来源，请点击来源链接查看完整报道。";
  }

  return clean.length > 110 ? `${clean.slice(0, 110).trim()}...` : clean;
}

function hasChinese(value = "") {
  return /[\u3400-\u9fff]/.test(value);
}

function limitForTranslation(value = "") {
  const clean = String(value).replace(/\s+/g, " ").trim();
  const bytes = Buffer.from(clean, "utf8");

  if (bytes.length <= 460) {
    return clean;
  }

  let output = "";
  for (const char of clean) {
    const next = `${output}${char}`;
    if (Buffer.from(next, "utf8").length > 460) {
      break;
    }
    output = next;
  }

  return `${output.trim()}...`;
}

async function translateToChinese(value) {
  const text = limitForTranslation(value);

  if (!text || hasChinese(text)) {
    return text;
  }

  const url = new URL(TRANSLATE_ENDPOINT);
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", "en|zh-CN");

  const result = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!result.ok) {
    throw new Error(`translation responded with ${result.status}`);
  }

  const payload = await result.json();
  return stripTags(payload?.responseData?.translatedText || text);
}

async function translateItem(item) {
  const originalTitle = item.title;
  const originalSummary = item.summary;

  try {
    const [title, summary] = await Promise.all([
      translateToChinese(item.title),
      translateToChinese(item.summary),
    ]);

    return {
      ...item,
      title: title || item.title,
      summary: compactText(summary || item.summary, 88),
      originalTitle,
      originalSummary,
      translation: "MyMemory 自动翻译",
    };
  } catch {
    return {
      ...item,
      originalTitle,
      originalSummary,
      translation: "自动翻译暂时不可用，已显示原文",
    };
  }
}

function compactText(value = "", maxLength = 88) {
  const clean = stripTags(value).replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength).trim()}...` : clean;
}

function parseRss(xml, source) {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];

  return itemBlocks.slice(0, 8).map((block) => {
    const title = textBetween(block, "title");
    const summary =
      textBetween(block, "description") ||
      textBetween(block, "summary") ||
      textBetween(block, "content:encoded");

    return {
      source: source.name,
      category: source.category,
      title,
      summary: summarize(summary),
      url: linkFromItem(block) || source.homepage,
      publishedAt: normalizeDate(
        textBetween(block, "pubDate") || textBetween(block, "updated") || textBetween(block, "published")
      ),
      label: "转载摘要 / 新闻线索",
    };
  });
}

function parsePublicPage(html, source) {
  const anchors = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const seen = new Set();
  const items = [];

  for (const anchor of anchors) {
    const href = decodeHtml(anchor[1]);
    const title = stripTags(anchor[2]);

    if (!title || title.length < 28 || seen.has(title)) {
      continue;
    }

    if (!href.includes("/article/") && !href.includes("/hub/") && !href.includes("/world/")) {
      continue;
    }

    const url = href.startsWith("http") ? href : new URL(href, source.homepage).href;
    seen.add(title);
    items.push({
      source: source.name,
      category: source.category,
      title,
      summary: `新闻线索来自 ${source.name} 公开页面，请点击来源链接查看完整报道。`,
      url,
      publishedAt: new Date().toISOString(),
      label: "转载摘要 / 新闻线索",
    });

    if (items.length >= 6) {
      break;
    }
  }

  return items;
}

async function fetchSource(source) {
  const response = await fetch(source.feed, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: source.type === "rss" ? "application/rss+xml, application/xml, text/xml" : "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`${source.name} responded with ${response.status}`);
  }

  const body = await response.text();
  return source.type === "page" ? parsePublicPage(body, source) : parseRss(body, source);
}

function interleaveBySource(items) {
  const grouped = new Map();

  const enabledSources = SOURCES.filter((source) => source.enabled !== false);

  for (const source of enabledSources) {
    grouped.set(source.name, items.filter((item) => item.source === source.name).slice(0, 3));
  }

  const mixed = [];
  for (let index = 0; index < 3; index += 1) {
    for (const source of enabledSources) {
      const nextItem = grouped.get(source.name)?.[index];
      if (nextItem) {
        mixed.push(nextItem);
      }
    }
  }

  return mixed;
}

module.exports = async function handler(_request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");

  const enabledSources = SOURCES.filter((source) => source.enabled !== false);
  const settled = await Promise.allSettled(enabledSources.map(fetchSource));
  const errors = [];
  const items = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    errors.push({
      source: enabledSources[index].name,
      message: result.reason?.message || "source failed",
    });
    return [];
  });

  const unique = [];
  const seenUrls = new Set();

  for (const item of items) {
    if (!item.title || !item.url || seenUrls.has(item.url)) {
      continue;
    }

    seenUrls.add(item.url);
    unique.push(item);
  }

  const mixed = interleaveBySource(unique).slice(0, 21);
  const translated = await Promise.all(mixed.map(translateItem));

  response.status(200).json({
    updatedAt: new Date().toISOString(),
    disclaimer: "以下内容为自动翻译的转载摘要 / 新闻线索，完整内容以原始来源页面为准。",
    sources: SOURCES.map(({ name, homepage }) => ({ name, homepage })),
    items: translated,
    errors,
  });
};
