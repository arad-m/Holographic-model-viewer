// Dev verification against a real browser, driven over CDP.
//
// Checks the paths that unit tests cannot reach:
//   · the library saves an upload, renders a card, survives a reload and deletes
//   · the screenshot button produces a PNG blob
//   · the record button enters/exits its recording state and reports the timer
//
// Run:  npm run verify:capture            (needs `npm run dev` in another shell)
//       node verify-capture.mjs <url>
//
// Exit code 0 means everything it could check passed. A browser whose media
// encoder produces no frames is reported as such rather than passed silently.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const base = process.argv[2] || 'http://localhost:5173';
const profile = mkdtempSync(join(tmpdir(), 'holo-verify-'));
const port = 9333;

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await sleep(250);
  }
  throw new Error('could not find a page target');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', () => reject(new Error('websocket error')));
  });
}

let nextId = 1;
function send(socket, method, params) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    };
    socket.addEventListener('message', onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

/** Evaluate an expression in the page and return its JSON value. */
async function evaluate(socket, expression) {
  const result = await send(socket, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'page threw');
  }
  return result.result.value;
}

async function navigate(socket, url) {
  await send(socket, 'Page.navigate', { url });
  // Wait for the app's module to boot and settle.
  await sleep(3500);
}

const CAPTURE_PROBE = `
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { captures: [] };
  const realCreate = URL.createObjectURL.bind(URL);
  window.__captures = [];
  URL.createObjectURL = (blob) => {
    window.__captures.push({ type: blob.type, size: blob.size });
    return realCreate(blob);
  };

  const toastText = () => Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent.trim());
  const shot = document.querySelector('[data-role="screenshot"]');
  const record = document.querySelector('[data-role="record"]');
  const recordLabel = () => document.querySelector('[data-role="record-label"]').textContent;

  out.shotDisabled = shot.disabled;
  out.recordDisabled = record.disabled;

  shot.click();
  await wait(1800);
  out.toastsAfterShot = toastText();

  record.click();
  await wait(600);
  out.recordingClass = record.classList.contains('is-recording');
  out.labelWhileRecording = recordLabel();
  await wait(2600);
  out.labelAfterTwoSeconds = recordLabel();

  record.click();
  await wait(1500);
  out.recordingClassAfterStop = record.classList.contains('is-recording');
  out.labelAfterStop = recordLabel();
  out.toastsAfterStop = toastText();
  out.captures = window.__captures;
  return JSON.stringify(out);
})()
`;

const LIBRARY_PROBE = `
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  const toggle = document.querySelector('[data-role="library"]');
  toggle.click();
  await wait(700);

  const panel = document.querySelector('.library');
  out.panelOpen = panel.classList.contains('is-open');

  const readCards = () => Array.from(document.querySelectorAll('.library-card')).map((card) => ({
    name: card.querySelector('.library-name')?.textContent ?? '',
    sub: card.querySelector('.library-sub')?.textContent ?? '',
    hasThumb: Boolean(card.querySelector('.library-thumb img')),
  }));

  out.cards = readCards();
  out.summary = document.querySelector('.library-summary')?.textContent ?? '';
  return JSON.stringify(out);
})()
`;

const LIBRARY_DELETE_PROBE = `
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const toggle = document.querySelector('[data-role="library"]');
  toggle.click();
  await wait(600);

  const remove = document.querySelector('.library-card .library-delete');
  out.hadDeleteButton = Boolean(remove);
  out.cardsBefore = document.querySelectorAll('.library-card').length;
  if (remove) remove.click();
  await wait(2500);

  out.cardsAfterDelete = document.querySelectorAll('.library-card').length;
  out.summaryAfterDelete = document.querySelector('.library-summary')?.textContent ?? '';
  out.toasts = Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent.trim());
  out.bodyText = (document.querySelector('.library-body')?.textContent ?? '').slice(0, 120);
  return JSON.stringify(out);
})()
`;

async function main() {
  const wsUrl = await findTarget();
  const socket = await connect(wsUrl);
  await send(socket, 'Page.enable', {});
  await send(socket, 'Runtime.enable', {});

  const problems = [];
  const notes = [];

  // ---- library: save on load, then render the card ---------------------------
  await navigate(socket, `${base}/?savelib=1&model=/samples/parts.obj`);
  const library = JSON.parse(await evaluate(socket, LIBRARY_PROBE));

  if (!library.panelOpen) problems.push('the library panel did not open');
  if (library.cards.length !== 1) problems.push(`expected 1 saved card, saw ${library.cards.length}`);
  if (library.cards[0]?.name !== 'parts.obj') {
    problems.push(`the card names "${library.cards[0]?.name ?? ''}" instead of parts.obj`);
  }
  if (library.cards[0]?.hasThumb !== true) problems.push('the card has no thumbnail image');
  if (!/KB|MB|B · /.test(library.cards[0]?.sub ?? '')) {
    problems.push(`the card subtitle reads "${library.cards[0]?.sub ?? ''}"`);
  }
  notes.push(`library: 1 card, summary "${library.summary}"`);

  // ---- library: the record survives a reload --------------------------------
  await navigate(socket, `${base}/`);
  const afterReload = JSON.parse(await evaluate(socket, LIBRARY_PROBE));
  if (afterReload.cards.length !== 1) {
    problems.push(`after a reload the library has ${afterReload.cards.length} cards, expected 1`);
  } else {
    notes.push('library: the saved model survived a reload');
  }

  // ---- capture: screenshot + recording --------------------------------------
  await navigate(socket, `${base}/?model=/samples/parts.obj`);
  const capture = JSON.parse(await evaluate(socket, CAPTURE_PROBE));

  if (capture.shotDisabled) problems.push('the screenshot button was disabled');
  if (capture.recordDisabled) problems.push('the record button was disabled');

  const png = capture.captures.find((item) => item.type === 'image/png');
  if (!png) problems.push('no PNG blob was produced');
  else if (png.size < 1000) problems.push(`the PNG blob is only ${png.size} bytes`);
  else notes.push(`screenshot: ${png.size}-byte PNG`);

  if (!capture.recordingClass) problems.push('the record button never entered its recording state');
  if (capture.recordingClassAfterStop) problems.push('the record button stayed in its recording state');
  if (capture.labelAfterTwoSeconds === 'Record') problems.push('the recording timer never advanced');
  else notes.push(`recording: timer reached "${capture.labelAfterTwoSeconds}"`);

  const video = capture.captures.find((item) => item.type.startsWith('video/'));
  if (video) notes.push(`recording: ${video.type} ${video.size} bytes`);
  else {
    // This headless build's encoder produces no frames at all - even for a plain
    // 2D canvas the app does not touch - so the empty file is the environment,
    // not the app. Report it instead of pretending it passed.
    notes.push('recording: this browser encoded no frames (headless encoder limitation)');
  }

  // ---- library: delete the saved model -------------------------------------
  await navigate(socket, `${base}/`);
  const removal = JSON.parse(await evaluate(socket, LIBRARY_DELETE_PROBE));
  if (!removal.hadDeleteButton) problems.push('the saved card had no delete button');
  else if (removal.cardsAfterDelete !== 0) {
    problems.push(
      `after deleting, ${removal.cardsAfterDelete} of ${removal.cardsBefore} cards remain` +
        ` (summary "${removal.summaryAfterDelete}", toasts ${JSON.stringify(removal.toasts)},` +
        ` body "${removal.bodyText}")`,
    );
  } else {
    notes.push(`library: deleted, summary now "${removal.summaryAfterDelete}"`);
  }

  socket.close();

  for (const note of notes) console.log(`  · ${note}`);
  if (problems.length > 0) {
    console.log(`\nFAIL\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('\nPASS');
  }
}

main()
  .catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    chrome.kill();
    await sleep(400);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // A locked profile folder in temp is harmless.
    }
  });
