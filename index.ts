#!/usr/bin/env npx tsx

import * as cheerio from 'cheerio';
import { load } from 'cheerio';
import { URL } from 'url';
import * as fs from 'fs';
import TurndownService from 'turndown';

/**
 * Normalize a URL by removing any hash fragment.
 */
function normalizeUrl(url: string): string {
	try {
		const normalized = new URL(url);
		normalized.hash = '';
		return normalized.toString();
	} catch {
		return url;
	}
}

/**
 * Fetch a page and return its HTML as text (or null on error).
 */
async function fetchPage(url: string): Promise<string | null> {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			console.error(`Failed to fetch ${url}: ${response.statusText}`);
			return null;
		}
		return await response.text();
	} catch (error) {
		console.error(`Error fetching ${url}:`, error);
		return null;
	}
}

/**
 * Crawl the website using BFS.
 * For each page, remove any JavaScript (i.e. <script> tags) before converting to Markdown.
 */
async function crawlWebsite(
	startUrl: string,
	outputFile: string = 'output.md'
): Promise<void> {
	const visited = new Set<string>();
	const normalizedStartUrl = normalizeUrl(startUrl);
	const queue: string[] = [normalizedStartUrl];
	const baseDomain = new URL(normalizedStartUrl).hostname;
	const pages: Array<{ url: string; content: string }> = [];
	const turndownService = new TurndownService();

	// Helper function to clean the HTML content
	function cleanHtmlContent($: cheerio.CheerioAPI): void {
		// Remove common navigation and duplicated elements
		$('nav, header, footer').remove();
		$('.navigation, .nav, .navbar, .menu').remove();
		$('.header, .footer').remove();
		$('.sidebar, .aside').remove();
		$('aside').remove();
		$('script').remove();
		$('style').remove();

		// Remove elements with common navigation-related roles
		$('[role="navigation"]').remove();
		$('[role="banner"]').remove();
		$('[role="contentinfo"]').remove();

		// Remove common navigation/header/footer classes and IDs
		$('#header, #footer, #nav, #navigation, #menu').remove();
		$('.social-links, .social-media').remove();
		$('.breadcrumbs').remove();
	}

	while (queue.length > 0) {
		const currentUrl = queue.shift()!;
		if (visited.has(currentUrl)) continue;

		console.log(`Crawling: ${currentUrl}`);
		visited.add(currentUrl);

		const html = await fetchPage(currentUrl);
		if (!html) continue;

		const $ = load(html);

		// Clean the HTML before converting to Markdown
		cleanHtmlContent($);

		// Get the cleaned HTML
		const cleanedHtml = $.html({
			scriptingEnabled: false,
			xml: true,
		});

		// Convert the cleaned HTML to Markdown
		const markdownContent = turndownService.turndown(cleanedHtml);
		pages.push({ url: currentUrl, content: markdownContent });

		// Find and process all anchor tags.
		$('a[href]').each((_, element) => {
			const href = $(element).attr('href');
			if (!href) return;

			try {
				// Skip image and asset URLs
				if (/\.(jpg|jpeg|png|gif|svg|ico|css|js)$/i.test(href)) return;

				// Resolve relative URLs and normalize by removing hash fragments.
				const newUrlObj = new URL(href, currentUrl);
				newUrlObj.hash = '';
				const normalizedUrl = newUrlObj.toString();

				// Only add URLs on the same domain that haven't been visited.
				if (newUrlObj.hostname === baseDomain && !visited.has(normalizedUrl)) {
					queue.push(normalizedUrl);
				}
			} catch {
				// Ignore invalid URLs.
			}
		});
	}

	// Combine all page Markdown content into one file.
	let outputMarkdown = '# Crawled Website Content\n\n';
	for (const page of pages) {
		outputMarkdown += `## ${page.url}\n\n`;
		outputMarkdown += `${page.content}\n\n`;
		outputMarkdown += `---\n\n`;
	}

	// Write the combined Markdown content to the specified output file
	fs.writeFileSync(outputFile, outputMarkdown, { encoding: 'utf-8' });
	console.log(`\nCrawling complete. Content written to ${outputFile}`);
}

/**
 * Main function: reads the URL from command-line arguments.
 */
async function main() {
	if (process.argv.length < 3) {
		console.error('Usage: ts-node crawler.ts <URL> [output-file]');
		process.exit(1);
	}

	const startUrl = process.argv[2];
	const outputFile = process.argv[3] || 'output.md';

	try {
		new URL(startUrl); // Validate URL
	} catch {
		console.error('Please provide a valid URL.');
		process.exit(1);
	}

	await crawlWebsite(startUrl, outputFile);
}

main();
