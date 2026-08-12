const SOURCES = [
  {
    name: "BBC",
    homepage: "https://www.bbc.com/news/world",
    feed: "https://feeds.bbci.co.uk/news/world/rss.xml",
    type: "rss",
  },
  {
    name: "The Guardian",
    homepage: "https://www.theguardian.com/world",
    feed: "https://www.theguardian.com/world/rss",
    type: "rss",
  },
  {
    name: "Reuters",
    homepage: "https://www.reuters.com/world/",
    feed: "https://www.reuters.com/world/",
    type: "page",
  },
  {
    name: "AP News",
    homepage: "https://apnews.com/hub/world-news",
    feed: "https://apnews.com/hub/world-news",
    type: "page",
  },
];

const USER_AGENT = "YANGX News Module/1.0 (+https://www.yangx.xyz)";

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

  return clean.length > 160 ? `${clean.slice(0, 160).trim()}...` : clean;
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

  for (const source of SOURCES) {
    grouped.set(source.name, items.filter((item) => item.source === source.name).slice(0, 4));
  }

  const mixed = [];
  for (let index = 0; index < 4; index += 1) {
    for (const source of SOURCES) {
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

  const settled = await Promise.allSettled(SOURCES.map(fetchSource));
  const errors = [];
  const items = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    errors.push({
      source: SOURCES[index].name,
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

  const mixed = interleaveBySource(unique);

  response.status(200).json({
    updatedAt: new Date().toISOString(),
    disclaimer: "以下内容为转载摘要 / 新闻线索，完整内容以原始来源页面为准。",
    sources: SOURCES.map(({ name, homepage }) => ({ name, homepage })),
    items: mixed.slice(0, 12),
    errors,
  });
};
