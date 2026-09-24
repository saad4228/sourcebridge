/**
 * Hand a finished post to the platform it was written for.
 *
 * The two platforms differ in what they allow, and the difference is not
 * cosmetic:
 *
 *  - X accepts prefilled text on its compose intent, so a post can arrive
 *    already written and the operator only has to press Post.
 *  - LinkedIn removed text prefill from its share URLs, so nothing can
 *    legitimately populate its composer from a link. The honest equivalent is
 *    to copy the post and open the composer ready to paste.
 *
 * Pretending otherwise would mean opening an empty LinkedIn box and leaving the
 * operator to wonder where their post went, so the caller is told which of the
 * two happened and the interface says so.
 */

import { X_POST_CHAR_LIMIT } from '../schemas';
import type { LinkedInPost, XThread } from '../schemas';

export type ShareOutcome =
  | { ok: true; mode: 'prefilled'; message: string }
  | { ok: true; mode: 'copied'; message: string }
  | { ok: false; message: string };

/** Compose the LinkedIn post exactly as it should be published. */
export function linkedinPostText(content: LinkedInPost): string {
  const parts = [content.hook, '', content.body, '', content.keyTakeaway];
  if (content.callToAction?.trim()) parts.push('', content.callToAction.trim());
  if (content.hashtags?.length) {
    parts.push('', content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' '));
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The full thread as text, numbered only when there is more than one post. */
export function xThreadText(content: XThread): string {
  if (content.posts.length === 1) return content.posts[0].text.trim();
  return content.posts
    .map((post, i) => `${i + 1}/${content.posts.length}\n${post.text.trim()}`)
    .join('\n\n');
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Open a composer without handing the opened tab a reference back to this one. */
function open(url: string): boolean {
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  return Boolean(win);
}

/**
 * Open LinkedIn's composer with the post on the clipboard.
 *
 * LinkedIn's share endpoint takes a URL to share, not post text, so the text
 * cannot be prefilled. Copying first means the operator pastes once and posts.
 */
export async function shareToLinkedIn(content: LinkedInPost): Promise<ShareOutcome> {
  const text = linkedinPostText(content);
  const copied = await copy(text);

  if (!open('https://www.linkedin.com/feed/?shareActive=true')) {
    return {
      ok: false,
      message: 'LinkedIn could not be opened. Allow pop-ups for this site, or copy the post instead.',
    };
  }

  return copied
    ? {
        ok: true,
        mode: 'copied',
        message: 'Post copied. LinkedIn is open — paste into the composer and publish.',
      }
    : {
        ok: true,
        mode: 'copied',
        message: 'LinkedIn is open, but the post could not be copied. Use "Copy text", then paste.',
      };
}

/**
 * Open X's composer with the first post already written.
 *
 * A thread cannot be prefilled beyond its opening post, so the whole thread is
 * copied as well and the caller is told that replies must be added by hand.
 */
export async function shareToX(content: XThread): Promise<ShareOutcome> {
  const first = content.posts[0]?.text?.trim() ?? '';
  if (!first) return { ok: false, message: 'This post is empty.' };

  const isThread = content.posts.length > 1;
  // Copy the whole thread so the remaining posts are to hand.
  if (isThread) await copy(xThreadText(content));

  const url = `https://x.com/intent/post?text=${encodeURIComponent(first)}`;
  if (!open(url)) {
    return {
      ok: false,
      message: 'X could not be opened. Allow pop-ups for this site, or copy the post instead.',
    };
  }

  if (first.length > X_POST_CHAR_LIMIT) {
    return {
      ok: true,
      mode: 'prefilled',
      message:
        `X is open with the post filled in, but it is ${first.length} characters — over the ` +
        `${X_POST_CHAR_LIMIT} limit. Trim it before posting.`,
    };
  }

  return {
    ok: true,
    mode: 'prefilled',
    message: isThread
      ? `X is open with post 1 of ${content.posts.length} filled in. The full thread is copied — add the replies after posting.`
      : 'X is open with your post filled in. Review it, then post.',
  };
}
