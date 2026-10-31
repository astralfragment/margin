/**
 * Report a problem with Margin: opens a new GitHub issue with the version,
 * browser and system already filled in, so a report takes a sentence.
 */

const ISSUES_URL = 'https://github.com/astralfragment/margin/issues/new';

/** The browser and system, from the user agent data where Chrome gives it. */
async function environment() {
  const data = navigator.userAgentData;
  try {
    const high = await data?.getHighEntropyValues(['fullVersionList', 'platformVersion']);
    const brand = high?.fullVersionList?.find((b) => /Chrome|Edge|Brave|Opera/i.test(b.brand) && !/Not/i.test(b.brand));
    if (brand) return `${brand.brand} ${brand.version} on ${data.platform} ${high.platformVersion ?? ''}`.trim();
  } catch {}
  return navigator.userAgent;
}

/**
 * Opens the prefilled issue in a new tab.
 * @param {string} [where] Which screen the report came from, such as Report or Popup.
 */
export async function reportProblem(where = '') {
  const version = chrome.runtime.getManifest().version;
  const body = [
    '**What happened?**',
    '',
    '',
    '**What did you expect?**',
    '',
    '',
    '**Steps to get there** (the page you were on helps)',
    '1. ',
    '',
    '---',
    `Margin ${version}${where ? `, from the ${where}` : ''}`,
    await environment(),
  ].join('\n');
  const url = `${ISSUES_URL}?${new URLSearchParams({ title: 'Problem: ', body, labels: 'bug' })}`;
  await chrome.tabs.create({ url });
}
