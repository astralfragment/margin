<p align="center">
  <img src="extension/icons/icon128.png" alt="" width="96" height="96">
</p>

<h1 align="center">Margin</h1>

<p align="center">Mark up any page. Hand over a clean review in Google Docs, Word, HTML or PDF.</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/ldhompocjnoloimngcpdlmfillfenmfa"><b>Add to Chrome</b></a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://lilacfragment.co.za/margin/">Website</a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://lilacfragment.co.za/margin/support/">Support</a>
  &nbsp;&nbsp;&nbsp;
  <a href="https://lilacfragment.co.za/margin/privacy/">Privacy</a>
  &nbsp;&nbsp;&nbsp;
  <a href="LICENSE">MIT license</a>
</p>

Margin is a free Chrome extension for website annotation, UI review and visual bug reporting. Drag over anything on a web page that looks wrong, write what is wrong, and pin numbered notes on the details. When you are done, Margin turns the whole review into a document a developer or client can act on straight away.

It needs no account. Everything stays in your browser until you choose to send a review to Jira or Figma.

## What it does

- **Start a review.** Name it, and link the Jira ticket and the Figma file it belongs to. Margin brings in the ticket's summary, status and assignee, and the file's frames, and uses them as the defaults when you send.
- **Comment on any area.** Drag a box over part of the page and a small card opens beside it, never over it. Type a title and press Enter to save.
- **Number the details.** Click inside the box to drop numbered markers, each with its own note. Right-click a marker to remove it.
- **Keep using the page.** Hold Alt to hover, open menus and scroll the page while annotating. Page dialogs and zoom don't get in the way.
- **Edit the image.** Add markers, boxes and arrows, resize them and zoom in. Changes save as you go.
- **Right-click for more.** Comment on one element or the whole visible screen without leaving the page.
- **Capture selectors when you need them.** Selector capture is off by default and one key turns it on.
- **Capture three widths at once.** From the comment card's menu or the right-click menu, Margin shoots the same selection at mobile, tablet and desktop sizes, and puts your window back exactly as it was.
- **Track each comment.** Every comment is Open, Fixed or Won't fix, and the report filters by status as well as severity.
- **Verify fixes in one pass.** Verify this page rechecks every comment on the open page, then walks you through before and after side by side. A pixel comparison hints at what changed.
- **Export it your way.** Copy for Docs pastes into Google Docs with images and numbered lists intact. Word, HTML and PDF exports are one click away. Copy as Markdown suits GitHub, Slack and coding agents, and any single comment copies on its own.
- **Share without a server.** Save review file packs the whole review, screenshots included, into one file a teammate can open in their own Margin.
- **Browser details.** Each comment records the browser, system and page zoom it was captured in.
- **Send it to Jira.** Connect once and Margin creates the issues with the screenshots attached, one per comment or one for the review. Without signing in, it opens Jira's own create form with the text filled in.
- **Post it to Figma.** Connect once and each comment lands on the frame its Figma link points at, with the numbered notes as a list.
- **Clean screenshots.** Margin hides its own interface before every capture.

## Install

The easiest way is the [Chrome Web Store](https://chromewebstore.google.com/detail/ldhompocjnoloimngcpdlmfillfenmfa).

To run it from source:

1. Clone this repository.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click Load unpacked and pick the `extension` folder.

## Using it

1. Open any page and click the Margin icon. Start a review, and link a Jira ticket or Figma file if you have one.
2. Drag over what looks wrong, type a title and press Enter.
3. Right-click the page and choose Open the review report.
4. Click Copy for Docs, or open More for Word, HTML, Print, Markdown, review files, Jira issues and Figma comments.

| Key | While annotating |
| --- | --- |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> | Start or stop annotating |
| <kbd>S</kbd> | Turn selector capture on or off |
| <kbd>M</kbd> | Turn numbered markers on or off |
| <kbd>V</kbd> | Comment on the whole visible area |
| <kbd>1</kbd> to <kbd>4</kbd> | Pick the severity of the open comment |
| <kbd>Enter</kbd> | Save the open comment from its title, or <kbd>Ctrl</kbd>+<kbd>Enter</kbd> from a note |
| Hold <kbd>Alt</kbd> | Use the page normally while annotating |
| <kbd>Shift</kbd>+<kbd>F10</kbd> | Open Margin's menu from the keyboard |
| <kbd>Esc</kbd> | Close the comment, or press twice to stop annotating |

## Privacy and permissions

Margin makes no network requests until you send a review to Jira or Figma. Reviews, screenshots and settings live in the browser's local extension storage until you delete them or remove the extension. The source is all here, so you can check.

Sending is opt-in. When you connect Jira or Figma, Chrome asks you to let Margin reach that service, and Margin then talks to it directly. Only what you send leaves your browser. That is the comment titles, notes, numbered notes, page addresses and Figma links, plus the screenshots for Jira. The sign-in tokens stay in the extension's local storage. Disconnect, under Connections in Help and settings, deletes them and hands the permission back.

Atlassian and Figma only finish a sign-in for apps that prove a private secret, and a secret cannot ship inside an extension. So one step of the sign-in goes through a small helper on lilacfragment.co.za, whose source is [server/margin-oauth.php](server/margin-oauth.php). It swaps the one-time sign-in code for tokens and renews them when they run out. It stores nothing and never sees your reviews. The web host's standard access log records the address of each request, which carries the one-time code. Those codes expire within minutes and only work together with the secret.

Jira's create form needs no sign-in at all. Margin opens it in a new tab with the text filled in. Find my site asks for access to atlassian.net, so Margin can see which Jira site you have open and list its projects through your existing Jira sign-in.

| Permission | Why Margin needs it |
| --- | --- |
| `activeTab` | Works only on the tab where you start it, at that moment |
| `scripting` | Adds the markup overlay to that tab and hides it during captures |
| `storage` | Keeps your reviews and settings on your device |
| `unlimitedStorage` | Screenshots quickly outgrow the default storage limit |
| `clipboardWrite` | Copy for Docs puts the review on the clipboard |
| `contextMenus` | Adds the right-click actions |
| `identity` | Opens the Jira or Figma sign-in window when you connect |
| `api.atlassian.com`, optional | Asked for when you connect Jira, to create issues and attach screenshots |
| `api.figma.com`, optional | Asked for when you connect Figma, to post comments |
| `*.atlassian.net`, optional | Asked for when you press Find my site, to spot your Jira site and its projects |

The install itself has no host permissions, so Margin cannot read pages in the background.

## Project layout

| Path | What lives there |
| --- | --- |
| `extension/content.js` | The overlay you draw on, with the note panel and markers |
| `extension/background.js` | Screenshots, image rendering, storage and the right-click menu |
| `extension/report.html` | The review report and its exports |
| `extension/editor.js` | The image editor for markers, boxes and arrows |
| `extension/send.js` | The Send to Jira and Send to Figma dialogs of the report |
| `extension/lib/` | Shared helpers for storage, templates, sign-in, Jira, Figma and the guided tour |
| `server/` | The sign-in helper that runs on lilacfragment.co.za, and its settings template |
| `extension/welcome.html` | The first-run guide |
| `extension/options.html` | Help and settings |

## Development

Margin is plain JavaScript modules with no build step and no dependencies. Edit a file, then click reload on the extension card in `chrome://extensions`.

Packaging, store listing and screenshot tools are kept outside this repository.

## Roadmap

1. Syncing tasks, so a status change in Jira shows in Margin
2. Workspaces and shared reviews
3. Agent handoff
4. Two-way Figma comment sync, with Jira links added to frames as dev resources
5. Accessibility check on the selected area
6. Off-token check against a design system
7. Linear and GitHub Issues export
8. MCP server so coding agents can read and close reviews

Ideas and bug reports are welcome in [Issues](https://github.com/astralfragment/margin/issues).

## License

[MIT](LICENSE). Copyright 2026 Lilac Fragment.
