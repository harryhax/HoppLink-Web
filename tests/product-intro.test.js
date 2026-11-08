// The product introduction at the top of the downloads page: its wording, where it sits, the two-column layout that
// stacks on phones, and the desktop app's screenshot (public/images/hopplink-app.png), which is shown at its own
// proportions only once it has really loaded. Run with: npm test
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { showScreenshotOnceLoaded } from '../src/pages/downloads.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const SCREENSHOT = 'public/images/hopplink-app.png';
const page = read('src/pages/downloads.js');
const styles = read('src/styles.css');
const [section] = page.match(/<section class="pm-intro[\s\S]*?<\/section>/) ?? [];
const [image] = (section ?? '').match(/<img\b[^>]*>/) ?? [];
const attribute = (tag, name) => tag?.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const rule = (selector) => styles.match(new RegExp(`${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[1];

describe('the introduction', () => {
  test('says what HoppLink does, in the agreed words', () => {
    assert.ok(section, 'the section is on the downloads page');
    assert.match(section, /aria-labelledby="pm-intro-title"/);
    assert.match(section, /<h2 class="[^"]*" id="pm-intro-title">Access the platforms you use\. Without a full VPN\.<\/h2>/);
    for (const paragraph of [
      'HoppLink is a lightweight desktop application that helps you access supported trading and prediction market websites using selective proxy routing.'
     ]) assert.ok(section.includes(`>${paragraph}</p>`), paragraph);
  });

  test('lists the four features, each with its heading', () => {
    const features = [...section.matchAll(/<li>[\s\S]*?<strong>([^<]+)<\/strong> ([^<]+)<\/span><\/li>/g)].map(([, name, detail]) => [name, detail]);
    assert.deepEqual(features, [
      ['Selective Routing:', 'Only supported websites use the HoppLink proxy. Other traffic stays on your normal connection.'],
      ['One-Click Connection:', 'Select a server and connect without manually configuring proxy settings.'],
      ['Lightweight Desktop App:', 'Available for Windows and macOS.'],
      ['Easy Disconnect:', 'Restore your previous system proxy configuration when finished.'],
    ]);
    // The icons are decoration; screen readers read the feature itself.
    for (const icon of section.match(/<i class="bi [^"]*"[^>]*>/g)) assert.match(icon, /aria-hidden="true"/);
  });

  test('sits below the header and above Supported Trading Platforms, with every other section kept', () => {
    const at = (marker) => page.indexOf(marker);
    assert.ok(at('</header>') < at('data-intro'), 'below the header');
    assert.match(page, /<main class="container pm-downloads-container py-5">\s*<section class="pm-intro/, 'first in the page body');
    assert.ok(at('data-intro') < at('data-platforms'), 'above Supported Trading Platforms');
    assert.ok(at('data-platforms') < at('data-community'));
    assert.ok(at('data-community') < at('Download HoppLink</h1>'));
    assert.ok(at('Download HoppLink</h1>') < at('data-builds'));
    assert.equal(page.match(/data-intro/g).length, 1);
  });

  test('is two columns on wide screens, text on the left, and stacks on phones', () => {
    assert.match(section, /<div class="row [^"]*">\s*<div class="col-12 col-lg">\s*<h2/, 'the text comes first, full width on phones');
    assert.match(section, /<div class="col-12 col-lg-6" data-app-screenshot hidden>/, 'the screenshot second, beside it from lg up');
    assert.ok(section.indexOf('pm-intro-title') < section.indexOf('data-app-screenshot'));
    // Nothing with a fixed width that could overflow a phone screen.
    assert.doesNotMatch(section, /style=|\bw-\d|\bcol-(?:sm|md)-/);
  });

  test('uses Bootstrap and the site\'s own styles, no new colours for the text', () => {
    assert.match(section, /text-body-secondary/);
    assert.match(section, /fw-semibold/);
    assert.ok(rule('.pm-intro-features'), 'the feature list rule');
    assert.ok(rule('.pm-intro-features li'));
  });
});

describe('the screenshot', () => {
  test('is the local desktop app screenshot, described for screen readers', () => {
    assert.ok(image, 'an image in the introduction');
    assert.equal(attribute(image, 'src'), '/images/hopplink-app.png');
    assert.equal(attribute(image, 'class'), 'pm-app-screenshot');
    const alt = attribute(image, 'alt');
    assert.ok(alt && alt.length >= 40, 'descriptive alt text');
    assert.match(alt, /HoppLink desktop app/);
    assert.doesNotMatch(attribute(image, 'src'), /^(?:https?:)?\/\//, 'served from this site');
    assert.doesNotMatch(attribute(image, 'src'), /download/i, 'not a picture of the downloads page');
  });

  test('keeps its proportions and has a subtle border, rounded corners and a shadow', () => {
    const css = rule('.pm-app-screenshot');
    assert.ok(css, 'the .pm-app-screenshot rule');
    assert.match(css, /width: 100%;/);
    assert.match(css, /max-width: 100%;/);
    assert.match(css, /height: auto;/, 'the height follows the width');
    assert.doesNotMatch(css, /object-fit: (?:fill|cover)|aspect-ratio|(?:^|[^-])height: \d/, 'never stretched or cropped');
    assert.match(css, /border: 1px solid #e5e7eb;/);
    assert.match(css, /border-radius: 0\.85rem;/);
    assert.match(css, /box-shadow: /);
  });

  test('is hidden until it has loaded, with no display utility that would override hidden', () => {
    const [column] = section.match(/<div [^>]*data-app-screenshot[^>]*>/);
    assert.match(column, /\bhidden\b/);
    assert.doesNotMatch(column, /\bd-(?:flex|block|inline|inline-block|grid|table)\b/);
    assert.match(page, /showScreenshotOnceLoaded\(page\.querySelector\('\[data-app-screenshot\]'\)\);/);
  });

  // A stand-in for the column and its <img>, with no browser.
  function fakeColumn({ complete = false, naturalWidth = 0 } = {}) {
    const listeners = {};
    const img = { complete, naturalWidth, addEventListener: (type, listener) => { listeners[type] = listener; } };
    const column = { hidden: true, querySelector: (selector) => (selector === 'img' ? img : null) };
    return { column, img, fire: (type) => listeners[type]?.() };
  }

  test('is shown once it loads as an image', () => {
    const { column, img, fire } = fakeColumn();
    showScreenshotOnceLoaded(column);
    assert.equal(column.hidden, true, 'hidden while loading');
    img.naturalWidth = 1440;
    fire('load');
    assert.equal(column.hidden, false);
  });

  test('is shown at once when the image was already loaded', () => {
    const { column } = fakeColumn({ complete: true, naturalWidth: 1440 });
    showScreenshotOnceLoaded(column);
    assert.equal(column.hidden, false);
  });

  test('stays hidden when the file is missing or isn\'t an image', () => {
    // A 404, or the site's HTML page served in its place: the image fails, or "completes" with no width.
    const failed = fakeColumn();
    showScreenshotOnceLoaded(failed.column);
    failed.fire('error');
    assert.equal(failed.column.hidden, true);

    const broken = fakeColumn({ complete: true, naturalWidth: 0 });
    showScreenshotOnceLoaded(broken.column);
    broken.fire('load');
    assert.equal(broken.column.hidden, true);
  });

  test('has its location documented', () => {
    const doc = read('docs/app-screenshot.md');
    assert.match(doc, /public\/images\/hopplink-app\.png/);
    assert.match(doc, /width.*height/);
  });

  test('is a real PNG, optimised for the web, with matching width and height', () => {
    assert.ok(existsSync(join(ROOT, SCREENSHOT)), `${SCREENSHOT} is in the repository`);
    const data = readFileSync(join(ROOT, SCREENSHOT));
    assert.deepEqual([...data.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'a PNG file');
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    assert.ok(width >= 800 && width <= 2400, `${width} pixels wide: sharp, but not oversized`);
    assert.ok(statSync(join(ROOT, SCREENSHOT)).size <= 600 * 1024, 'at most 600 KB');

    const tagWidth = Number(attribute(image, 'width'));
    const tagHeight = Number(attribute(image, 'height'));
    assert.ok(tagWidth > 0 && tagHeight > 0, 'width and height on the tag reserve its space');
    assert.ok(Math.abs(tagWidth / tagHeight - width / height) / (width / height) < 0.02, 'the same proportions as the file');
    assert.deepEqual([tagWidth, tagHeight], [width, height], 'the file\'s own size on the tag');
  });
});
