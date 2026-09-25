/**
 * Article fetching for URL sources.
 *
 * Fetching a user-supplied URL server-side is a server-side request forgery
 * risk: without checks, an operator could make the server read cloud metadata
 * endpoints or internal services. Every host is resolved and screened against
 * private ranges before a request is made, and again after each redirect.
 */

import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateAddress } from './net';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

export class UrlFetchError extends Error {
  constructor(message: string, readonly kind: 'invalid_url' | 'blocked' | 'unreachable' | 'unusable') {
    super(message);
    this.name = 'UrlFetchError';
  }
}

export const URL_LIMITS = {
  maxBytes: 4 * 1024 * 1024,
  timeoutMs: 15_000,
  maxRedirects: 4,
} as const;

/** Reject anything that is not a public http(s) endpoint. */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlFetchError(`"${raw}" is not a valid URL.`, 'invalid_url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlFetchError('Only http and https URLs can be fetched.', 'blocked');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true })
        .then((entries) => entries.map((e) => e.address))
        .catch(() => {
          throw new UrlFetchError(`The address ${url.hostname} could not be resolved.`, 'unreachable');
        });

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UrlFetchError(
      `${url.hostname} resolves to a private or local address, which SourceBridge will not fetch.`,
      'blocked',
    );
  }

  return url;
}

/** Convert the readable article DOM to text, one block element per line. */
function blocksToText(html: string): string {
  const { document } = parseHTML(`<body>${html}</body>`);
  const lines: string[] = [];

  for (const node of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption,td,th')) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    // Table cells belong on one row rather than one line each.
    const tag = node.tagName.toLowerCase();
    if ((tag === 'td' || tag === 'th') && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]}  ${text}`;
    } else {
      lines.push(text);
    }
  }

  // Drop duplicate adjacent lines, which boilerplate templates often produce.
  return lines.filter((line, i) => line !== lines[i - 1]).join('\n');
}

/**
 * Read a response body, giving up as soon as it exceeds the cap.
 *
 * Buffering the whole body and checking its length afterwards meant a hostile
 * or merely broken endpoint could hold arbitrary memory on the server before
 * the size limit was ever consulted: the check ran after the damage. The
 * declared length is honoured when present, but it is a claim the server makes
 * about itself, so the running total is what actually enforces the limit.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const tooLarge = () =>
    new UrlFetchError(`The page is larger than ${maxBytes / 1024 / 1024} MB.`, 'unusable');

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw tooLarge();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const merged = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    merged.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

export interface FetchedArticle {
  title: string;
  text: string;
  finalUrl: string;
  warnings: string[];
}

/** Fetch a URL and return its readable article text. */
export async function fetchArticle(raw: string): Promise<FetchedArticle> {
  let url = await assertPublicUrl(raw);
  const warnings: string[] = [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_LIMITS.timeoutMs);

  let response: Response;
  try {
    // Redirects are followed manually so each hop is screened too.
    for (let hop = 0; ; hop++) {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Identify honestly rather than impersonating a browser.
          'User-Agent': 'SourceBridge/1.0 (content transformation prototype)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        if (hop >= URL_LIMITS.maxRedirects) {
          throw new UrlFetchError('Too many redirects.', 'unreachable');
        }
        url = await assertPublicUrl(new URL(location, url).toString());
        continue;
      }
      break;
    }
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof UrlFetchError) throw err;
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new UrlFetchError(
      aborted
        ? `${raw} took longer than ${URL_LIMITS.timeoutMs / 1000} seconds to respond.`
        : `${raw} could not be reached.`,
      'unreachable',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new UrlFetchError(`${url.hostname} returned HTTP ${response.status}.`, 'unreachable');
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    throw new UrlFetchError(
      `${url.hostname} returned ${contentType || 'an unknown type'} rather than a web page. ` +
        `Download the file and upload it instead.`,
      'unusable',
    );
  }

  const html = await readCapped(response, URL_LIMITS.maxBytes);
  const { document } = parseHTML(html);
  const documentTitle = document.querySelector('title')?.textContent?.trim() ?? '';

  let title = documentTitle;
  let text = '';

  try {
    const article = new Readability(document as unknown as Document).parse();
    if (article?.content) {
      title = article.title?.trim() || documentTitle;
      text = blocksToText(article.content);
    }
  } catch {
    // Readability can fail on unusual markup; fall through to the whole body.
  }

  if (text.replace(/\s/g, '').length < 200) {
    warnings.push(
      'Readable article text could not be identified reliably, so the whole page was used. ' +
        'Check the extracted text for navigation and boilerplate before generating.',
    );
    text = blocksToText(document.body?.innerHTML ?? '');
  }

  if (text.replace(/\s/g, '').length < 50) {
    throw new UrlFetchError(
      `No readable text was found at ${url.hostname}. The page may require JavaScript or a login. ` +
        `Copy the text and paste it instead.`,
      'unusable',
    );
  }

  warnings.push(
    'Extracted from a web page. Site layouts vary, so confirm the text matches the article before ' +
      'relying on it.',
  );

  return { title: title || url.hostname, text, finalUrl: url.toString(), warnings };
}
