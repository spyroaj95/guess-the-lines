// A tiny DOM morph. Instead of throwing the screen away on every update (innerHTML), patch the
// existing elements to match the new markup. Elements survive re-renders, so focus and scroll
// stay put and CSS transitions can animate state changes (a team lighting up, the progress bar
// filling). Elements whose data-key differs are swapped out instead of patched, which is how a
// new week or tab gets a fresh entrance animation.

export function morphInto(parent, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(parent, tpl.content);
}

function same(a, b) {
  return (
    a.nodeType === b.nodeType &&
    a.nodeName === b.nodeName &&
    (a.nodeType !== 1 || a.getAttribute('data-key') === b.getAttribute('data-key'))
  );
}

function patch(from, to) {
  if (!same(from, to)) return from.replaceWith(to);
  if (from.nodeType !== 1) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  for (const { name } of Array.from(from.attributes)) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of Array.from(to.attributes)) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  patchChildren(from, to);
}

function patchChildren(from, to) {
  const next = Array.from(to.childNodes);
  const prev = Array.from(from.childNodes);
  next.forEach((node, i) => (i < prev.length ? patch(prev[i], node) : from.appendChild(node)));
  for (let i = next.length; i < prev.length; i++) prev[i].remove();
}
