const command = (await chrome.commands.getAll()).find((c) => c.name === 'toggle-annotate');
const shortcut = command?.shortcut || 'the shortcut you set in Chrome';

const STEPS = [
  {
    title: 'Start annotating',
    body: `Open the page you are reviewing, then click the Margin icon or press ${shortcut}. A sheet covers the page and the bar at the top shows you are reviewing. Esc stops.`,
  },
  {
    title: 'Drag over what looks wrong',
    body: 'Drag a box around the problem and Margin takes a screenshot of it. Press S first if you also want the element and its CSS selector.',
  },
  {
    title: 'Say what is wrong',
    body: 'Write a short title and a note, pick a severity, and save. The note opens beside your box so the problem stays in view.',
  },
  {
    title: 'Right-click for more',
    body: "While annotating, right-click to comment on one element or on everything you can see. Chrome's own right-click menu has Margin in it too.",
  },
  {
    title: 'Number the details',
    body: 'In the report, click any screenshot to open the image editor. Add numbered markers, boxes and arrows, each with its own note. Right-click a number to remove it.',
  },
  {
    title: 'Hand it over',
    body: 'Copy the review for Docs, or download a Word or HTML file. Numbered notes come out as a numbered list. Recheck a comment after the fix to show it before and after.',
  },
];

const stage = document.querySelector('[data-stage]');
const list = document.querySelector('[data-steps]');
const back = document.querySelector('[data-back]');
const next = document.querySelector('[data-next]');
let current = 0;

list.innerHTML = STEPS.map(
  (step, i) => `<li><button class="guide-step" type="button" data-i="${i}">
    <span class="disc">${i + 1}</span>
    <span><b>${step.title}</b><p>${step.body}</p></span>
  </button></li>`,
).join('');

/**
 * Shows one step of the guide on the stage and in the list.
 * @param {number} i The step index.
 */
function go(i) {
  current = Math.min(Math.max(0, i), STEPS.length - 1);
  stage.dataset.step = String(current + 1);
  list.querySelectorAll('.guide-step').forEach((b, n) => {
    if (n === current) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  });
  back.hidden = current === 0;
  next.textContent = current === STEPS.length - 1 ? 'Open the report' : 'Next';
}

list.addEventListener('click', (e) => {
  const button = e.target.closest('[data-i]');
  if (button) go(Number(button.dataset.i));
});
back.addEventListener('click', () => go(current - 1));
next.addEventListener('click', () => {
  if (current === STEPS.length - 1) chrome.runtime.sendMessage({ type: 'openReport' });
  else go(current + 1);
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (e.key === 'ArrowRight') go(current + 1);
  if (e.key === 'ArrowLeft') go(current - 1);
});
document.querySelector('[data-help]').addEventListener('click', () => chrome.runtime.openOptionsPage());

go(0);
