/**
 * Column paginator with a real page-turn animation.
 *
 * Text is laid out with CSS multi-column: the page "stride" equals the width
 * of the viewport, so moving one page is a single translate. The turn effect
 * clones the outgoing and incoming spreads onto a sheet that rotates around
 * the gutter in 3D, with a static layer keeping the untouched half correct
 * while the sheet is mid-air.
 */

import { clamp, el } from '../core/utils.js';

export function createPaginator({ pager, inner, flipLayer, onPageChange }) {
  let rtl = false;
  let columns = 2;
  let stride = 1;
  let pageCount = 1;
  let page = 0;
  let animating = false;

  const sign = () => (rtl ? 1 : -1);

  function setDirection(isRtl) {
    rtl = isRtl;
    inner.dir = isRtl ? 'rtl' : 'ltr';
  }

  function setColumns(count) {
    columns = count;
    inner.style.columnCount = count > 1 ? String(count) : '1';
  }

  /** Recompute stride and page count for the current content and size. */
  function measure() {
    const previousTransition = inner.style.transition;
    inner.style.transition = 'none';
    stride = pager.clientWidth || 1;
    const total = inner.scrollWidth;
    pageCount = Math.max(1, Math.round(total / stride));
    // scrollWidth can fall a hair short of a full page; guard against 0-width.
    if (total - (pageCount - 1) * stride > stride * 0.02 && total > pageCount * stride) {
      pageCount += 1;
    }
    page = clamp(page, 0, pageCount - 1);
    apply(false);
    // Force a reflow before restoring the transition so nothing animates.
    void inner.offsetWidth;
    inner.style.transition = previousTransition;
    return { stride, pageCount };
  }

  function apply(animate = true) {
    inner.classList.toggle('no-anim', !animate);
    inner.style.transform = `translateX(${sign() * page * stride}px)`;
    if (!animate) {
      void inner.offsetWidth;
      inner.classList.remove('no-anim');
    }
  }

  /** Layout X of an element inside the (possibly translated) inner box. */
  function layoutXOf(element) {
    const pagerRect = pager.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const edge = rtl ? rect.right - pagerRect.right : rect.left - pagerRect.left;
    return edge - sign() * page * stride;
  }

  /** Which page a layout X belongs to. */
  function pageOfLayoutX(x) {
    const value = rtl ? -x : x;
    return clamp(Math.floor(value / stride + 0.001), 0, pageCount - 1);
  }

  function pageOfElement(element) {
    return pageOfLayoutX(layoutXOf(element));
  }

  /* ----------------------------------------------------- page turning */

  function cloneSpread() {
    const clone = inner.cloneNode(true);
    clone.style.transition = 'none';
    clone.style.position = 'absolute';
    clone.style.top = '0';
    clone.style.left = '0';
    clone.style.width = `${pager.clientWidth}px`;
    clone.style.height = `${pager.clientHeight}px`;
    clone.classList.remove('no-anim');
    return clone;
  }

  /**
   * Build one clipped half of a spread clone.
   * @param {HTMLElement} clone
   * @param {'left'|'right'|'full'} half
   */
  function makeHalf(clone, half) {
    const width = half === 'full' ? pager.clientWidth : pager.clientWidth / 2;
    const box = el('div', {
      style: {
        position: 'absolute',
        top: '0',
        width: `${width}px`,
        height: `${pager.clientHeight}px`,
        overflow: 'hidden',
        background: 'linear-gradient(180deg, var(--page-bg), var(--page-bg-2))',
      },
    });
    const shifted = clone.cloneNode(true);
    shifted.style.left = half === 'right' ? `${-width}px` : '0px';
    box.append(shifted);
    return box;
  }

  /**
   * Animate a page turn.
   * @param {1|-1} direction  1 = forward, -1 = backward
   * @param {'curl'|'slide'|'fade'|'none'} style
   */
  async function turn(direction, style = 'curl') {
    if (animating) return false;
    // `page` indexes whole screens, so one turn is always one stride — in a
    // two-column spread that is two printed pages at once.
    const target = page + direction;
    if (target < 0 || target > pageCount - 1) return false;

    if (style !== 'curl' || pager.clientWidth < 380) {
      animating = true;
      page = clamp(target, 0, pageCount - 1);
      if (style === 'fade') {
        inner.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
        apply(false);
      } else {
        apply(style !== 'none');
      }
      onPageChange?.(page, pageCount);
      await new Promise((resolve) => setTimeout(resolve, style === 'none' ? 0 : 260));
      animating = false;
      return true;
    }

    animating = true;
    const oldClone = cloneSpread();
    page = clamp(target, 0, pageCount - 1);
    apply(false);
    const newClone = cloneSpread();
    onPageChange?.(page, pageCount);

    const half = pager.clientWidth / 2;
    const single = columns === 1;
    // In LTR the right half turns; in RTL the left half does.
    const sheetSide = rtl ? 'left' : 'right';
    const sheetHalf = single ? 'full' : sheetSide === 'right' ? 'right' : 'left';
    const staticHalf = single ? null : sheetSide === 'right' ? 'left' : 'right';

    const layer = el('div', {
      style: {
        position: 'absolute',
        inset: '0',
        transformStyle: 'preserve-3d',
        perspective: '2200px',
      },
    });

    // The half that stays put must keep showing the OLD spread while the
    // sheet is in the air.
    let staticLayer = null;
    if (staticHalf) {
      const source = direction === 1 ? oldClone : oldClone;
      staticLayer = makeHalf(source, staticHalf === 'left' ? 'left' : 'right');
      staticLayer.style[staticHalf === 'left' ? 'left' : 'right'] = '0px';
      staticLayer.style.zIndex = '1';
      layer.append(staticLayer);
    }

    const sheet = el('div', {
      style: {
        position: 'absolute',
        top: '0',
        [sheetSide]: '0px',
        width: single ? '100%' : `${half}px`,
        height: '100%',
        transformStyle: 'preserve-3d',
        transformOrigin: sheetSide === 'right' ? 'left center' : 'right center',
        zIndex: '2',
        willChange: 'transform',
      },
    });

    // Forward: front = old outgoing page, back = new incoming facing page.
    // Backward: the same sheet unfolds the other way, so the faces swap.
    const frontSource = direction === 1 ? oldClone : newClone;
    const backSource = direction === 1 ? newClone : oldClone;
    const frontHalfName = single ? 'full' : sheetHalf;
    const backHalfName = single ? 'full' : sheetHalf === 'right' ? 'left' : 'right';

    const front = makeHalf(frontSource, frontHalfName);
    Object.assign(front.style, {
      left: '0',
      backfaceVisibility: 'hidden',
      boxShadow: '0 0 30px rgb(0 0 0 / .28)',
    });
    const back = makeHalf(backSource, backHalfName);
    Object.assign(back.style, {
      left: '0',
      transform: 'rotateY(180deg)',
      backfaceVisibility: 'hidden',
      boxShadow: '0 0 30px rgb(0 0 0 / .28)',
    });

    const frontShade = el('div', {
      style: {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        background:
          sheetSide === 'right'
            ? 'linear-gradient(90deg, rgb(0 0 0 / .45), transparent 55%)'
            : 'linear-gradient(270deg, rgb(0 0 0 / .45), transparent 55%)',
        opacity: '0',
      },
    });
    const backShade = el('div', {
      style: {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        background:
          sheetSide === 'right'
            ? 'linear-gradient(270deg, rgb(0 0 0 / .5), transparent 55%)'
            : 'linear-gradient(90deg, rgb(0 0 0 / .5), transparent 55%)',
        opacity: '0.6',
      },
    });
    front.append(frontShade);
    back.append(backShade);
    sheet.append(front, back);
    layer.append(sheet);

    flipLayer.replaceChildren(layer);

    const flipAngle = sheetSide === 'right' ? -180 : 180;
    const from = direction === 1 ? 0 : flipAngle;
    const to = direction === 1 ? flipAngle : 0;
    const duration = 620;
    const easing = 'cubic-bezier(.36,.06,.24,1)';

    const animation = sheet.animate(
      [
        { transform: `rotateY(${from}deg) translateZ(0px)` },
        { transform: `rotateY(${(from + to) / 2}deg) translateZ(26px)`, offset: 0.5 },
        { transform: `rotateY(${to}deg) translateZ(0px)` },
      ],
      { duration, easing, fill: 'forwards' }
    );
    frontShade.animate(
      direction === 1 ? [{ opacity: 0 }, { opacity: 0.55 }] : [{ opacity: 0.55 }, { opacity: 0 }],
      { duration, easing, fill: 'forwards' }
    );
    backShade.animate(
      direction === 1 ? [{ opacity: 0.6 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 0.6 }],
      { duration, easing, fill: 'forwards' }
    );

    await animation.finished.catch(() => {});
    flipLayer.replaceChildren();
    animating = false;
    return true;
  }

  function goTo(index, { animate = false } = {}) {
    page = clamp(index, 0, pageCount - 1);
    apply(animate);
    onPageChange?.(page, pageCount);
  }

  return {
    setDirection,
    setColumns,
    measure,
    goTo,
    turn,
    pageOfElement,
    pageOfLayoutX,
    layoutXOf,
    get page() {
      return page;
    },
    get pageCount() {
      return pageCount;
    },
    get stride() {
      return stride;
    },
    get columns() {
      return columns;
    },
    get busy() {
      return animating;
    },
  };
}
