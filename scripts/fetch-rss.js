#!/usr/bin/env node

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseRSS(xmlText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];

    const title = (itemContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
      itemContent.match(/<title>(.*?)<\/title>/))?.[1] || '';

    const link = itemContent.match(/<link>(.*?)<\/link>/)?.[1] || '';

    const description = (itemContent.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
      itemContent.match(/<description>(.*?)<\/description>/))?.[1] || '';

    const pubDate = itemContent.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';

    // Enclosure attributes appear in either order across feeds.
    const enclosureMatch = itemContent.match(/<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]*)"/) ||
      itemContent.match(/<enclosure[^>]*url="([^"]*)"[^>]*type="image[^"]*"/);
    const image = enclosureMatch?.[1] || null;

    const cleanDescription = description
      .replace(/<[^>]*>/g, '')
      .trim();

    const finalDescription = cleanDescription.length > 150
      ? cleanDescription.substring(0, 150) + '...'
      : cleanDescription;

    items.push({
      title,
      link,
      description: finalDescription,
      pubDate: new Date(pubDate).toISOString(),
      image
    });
  }

  // Newest first, then skip the lead item and take the next two.
  return items
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .slice(1, 3);
}

async function fetchRSSFeed() {
  try {
    console.log('Fetching RSS feed from diagramchasing.fun...');

    const response = await fetch('https://diagramchasing.fun/rss.xml');

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const xmlText = await response.text();
    const feedItems = parseRSS(xmlText);

    const outputPath = join(__dirname, '../src/lib/data/rss-feed.json');
    const output = {
      lastUpdated: new Date().toISOString(),
      items: feedItems
    };

    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(`✅ Successfully fetched ${feedItems.length} RSS items`);
    console.log(`📄 Written to: ${outputPath}`);

    feedItems.forEach((item, index) => {
      console.log(`${index + 1}. ${item.title} (${new Date(item.pubDate).toLocaleDateString()})`);
    });

  } catch (error) {
    console.error('❌ Error fetching RSS feed:', error.message);

    const outputPath = join(__dirname, '../src/lib/data/rss-feed.json');
    const fallback = {
      lastUpdated: new Date().toISOString(),
      error: error.message,
      items: []
    };

    writeFileSync(outputPath, JSON.stringify(fallback, null, 2));
    console.log('📄 Created fallback file with error info');

    process.exit(1);
  }
}

fetchRSSFeed();