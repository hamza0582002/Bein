/**
 * Character-offset ↔ DOM Range helpers.
 *
 * Highlights, in-book search and read-aloud all address text by its offset in
 * the rendered chapter, which survives re-rendering far better than XPaths.
 */

function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}

/** Plain text of the container, using the same walk order as the mappers. */
export function fullText(root) {
  return textNodes(root)
    .map((node) => node.nodeValue)
    .join('');
}

/** Character offset of (node, offset) within `root`. */
export function offsetOf(root, node, offset) {
  let total = 0;
  for (const textNode of textNodes(root)) {
    if (textNode === node) return total + offset;
    total += textNode.nodeValue.length;
  }
  return total;
}

/** Offsets of a Range within `root`, or null when it is outside. */
export function offsetsOfRange(root, range) {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = offsetOf(root, range.startContainer, range.startOffset);
  const end = offsetOf(root, range.endContainer, range.endOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

/** Build a Range from character offsets within `root`. */
export function rangeFromOffsets(root, start, end) {
  const range = document.createRange();
  let position = 0;
  let startSet = false;
  for (const node of textNodes(root)) {
    const length = node.nodeValue.length;
    if (!startSet && position + length >= start) {
      range.setStart(node, Math.max(0, start - position));
      startSet = true;
    }
    if (startSet && position + length >= end) {
      range.setEnd(node, Math.max(0, Math.min(length, end - position)));
      return range;
    }
    position += length;
  }
  if (!startSet) return null;
  const last = textNodes(root).pop();
  if (last) range.setEnd(last, last.nodeValue.length);
  return range;
}

/**
 * Wrap everything inside `range` with elements produced by `makeWrapper`,
 * splitting across element boundaries as needed.
 */
export function wrapRange(range, makeWrapper) {
  const root = range.commonAncestorContainer;
  const scope = root.nodeType === Node.TEXT_NODE ? root.parentNode : root;
  const created = [];

  const nodes = textNodes(scope).filter((node) => range.intersectsNode(node));
  for (const node of nodes) {
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
    if (end <= start) continue;

    let target = node;
    if (end < target.nodeValue.length) target.splitText(end);
    if (start > 0) target = target.splitText(start);

    const wrapper = makeWrapper();
    target.parentNode.insertBefore(wrapper, target);
    wrapper.append(target);
    created.push(wrapper);
  }
  return created;
}

/** Remove a wrapper element but keep its text, then normalise the parent. */
export function unwrap(element) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  element.remove();
  parent.normalize();
}

/** Case/diacritics-insensitive search that also ignores Arabic tatweel. */
export function normaliseForSearch(text) {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '') // harakat + tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/**
 * Find matches of `needle` in `haystack`, returning offsets in the ORIGINAL
 * string even though the comparison is done on the normalised form.
 */
export function findMatches(haystack, needle) {
  const query = normaliseForSearch(needle).trim();
  if (!query) return [];

  // Map every normalised character back to its source index.
  const map = [];
  let normalised = '';
  for (let i = 0; i < haystack.length; i++) {
    const piece = normaliseForSearch(haystack[i]);
    for (let k = 0; k < piece.length; k++) map.push(i);
    normalised += piece;
  }

  const matches = [];
  let from = 0;
  for (;;) {
    const index = normalised.indexOf(query, from);
    if (index === -1) break;
    const start = map[index];
    const endIndex = index + query.length - 1;
    const end = (map[endIndex] ?? haystack.length - 1) + 1;
    matches.push({ start, end });
    from = index + query.length;
  }
  return matches;
}
