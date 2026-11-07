// The "Supported Trading Platforms" section on the downloads page, which / redirects to: each platform's logo is a
// local, cleaned file in public/brands/, shown in its own colours and proportions with alt text, in a responsive grid,
// with the independence disclaimer and no wording that suggests a partnership or availability everywhere.
// Images are checked from their SVG and PNG headers, so no browser is needed. Run with: npm test
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HOME_TARGET } from '../src/home-redirect.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const bytes = (path) => readFileSync(join(ROOT, path));

const PLATFORMS = ['Polymarket', 'Binance', 'BingX', 'Bybit', 'HTX', 'Kalshi', 'OKX', 'Pionex'];
const DISCLAIMER = 'HoppLink is an independent service and is not affiliated with or endorsed by the platforms shown.';

const page = read('src/pages/downloads.js');
const [section] = page.match(/<section class="pm-platforms[\s\S]*?<\/section>/) ?? [];
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const logos = () => [...(section ?? '').matchAll(/<img\b[^>]*>/g)].map(([tag]) => ({
  tag, src: attribute(tag, 'src'), alt: attribute(tag, 'alt'), width: Number(attribute(tag, 'width')), height: Number(attribute(tag, 'height')),
}));

/** Width and height of a logo file: an SVG's viewBox, or a PNG's IHDR (also returning its colour type). */
function size(file) {
  const data = bytes(file);
  if (file.endsWith('.svg')) {
    const [, , , w, h] = data.toString('utf8').match(/viewBox="([\d.-]+) ([\d.-]+) ([\d.]+) ([\d.]+)"/) ?? [];
    return { width: Number(w), height: Number(h) };
  }
  assert.deepEqual([...data.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${file} is a PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), colourType: data[25] };
}

describe('the section', () => {
  test('is on the page that serves as the homepage, titled "Supported Trading Platforms"', () => {
    assert.equal(HOME_TARGET, '/downloads', '/ redirects to the downloads page');
    assert.ok(section, 'the section is on the downloads page');
    assert.match(section, /aria-labelledby="pm-platforms-title"/);
    assert.match(section, /<h2 class="[^"]*" id="pm-platforms-title">Supported Trading Platforms<\/h2>/);
  });

  test('shows each platform once, in order, named for screen readers; Kashi is not added until identified', () => {
    assert.deepEqual(logos().map((l) => l.alt), PLATFORMS);
    assert.doesNotMatch(page, /kashi/i);
  });

  test('has the independence disclaimer', () => {
    assert.ok(section.includes(`>${DISCLAIMER}</p>`));
  });

  test('never suggests a partnership, endorsement or availability everywhere', () => {
    const words = section.replace(/<[^>]*>/g, ' ').replace(DISCLAIMER, '');
    assert.doesNotMatch(words, /\b(partner\w*|official\w*|endorse\w*|sponsor\w*|approved|certified|guarantee\w*|integrat\w*|in every (country|region))\b/i);
    assert.match(words, /regional restrictions still apply/);
    assert.match(words, /not every platform is available everywhere/);
  });

  test('is a responsive grid: two logos a row on phones, four from tablets up', () => {
    assert.match(section, /<ul class="row row-cols-2 row-cols-md-4 g-3 list-unstyled mb-0">/);
    assert.equal((section.match(/<li class="col"><div class="pm-platform"><img class="pm-platform-logo" /g) ?? []).length, PLATFORMS.length);
  });
});

describe('the logos', () => {
  test('are local files in public/brands/, never another site or CDN', () => {
    const files = readdirSync(join(ROOT, 'public/brands')).sort();
    assert.deepEqual(logos().map((l) => l.src.replace('/brands/', '')).sort(), files, 'every file is used, and only these');
    for (const { src, tag } of logos()) {
      assert.match(src, /^\/brands\/[a-z]+\.(svg|png)$/, tag);
      assert.match(tag, /loading="lazy" decoding="async"/, tag);
    }
  });

  test('keep their own proportions: each tag has the file\'s aspect ratio', () => {
    for (const { src, width, height } of logos()) {
      const file = size(join('public', src));
      assert.ok(Math.abs(width / height - file.width / file.height) / (file.width / file.height) < 0.02,
        `${src}: ${width}x${height} on the tag, ${file.width}x${file.height} in the file`);
    }
  });

  test('PNGs are transparent and SVGs only draw: no scripts, links, embedded images or outside resources', () => {
    for (const { src } of logos()) {
      const file = join('public', src);
      assert.ok(bytes(file).length < 20 * 1024, `${src} is small`);
      if (src.endsWith('.png')) {
        assert.equal(size(file).colourType, 6, `${src}: RGBA`);
        continue;
      }
      const svg = read(file);
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, src);
      assert.doesNotMatch(svg, /<script|javascript:|href|\son[a-z]+=|<image|<foreignObject|@import|url\((?!#)|<!DOCTYPE|<!ENTITY/i, src);
    }
  });

  test('are shown in their own colours at one height, never stretched or filtered', () => {
    const styles = read('src/styles.css');
    const [, rule] = styles.match(/\.pm-platform-logo \{([^}]*)\}/) ?? [];
    assert.ok(rule, 'the .pm-platform-logo rule');
    assert.match(rule, /height: 1\.75rem;/);
    assert.match(rule, /width: auto;/);
    assert.match(rule, /max-width: 100%;/);
    assert.match(rule, /object-fit: contain;/);
    assert.doesNotMatch(styles, /\.pm-platform[^{]*\{[^}]*(filter|opacity|mix-blend-mode|grayscale)/);
  });

  test('sit on white tiles like the rest of the site\'s cards', () => {
    const [, tile] = read('src/styles.css').match(/\.pm-platform \{([^}]*)\}/) ?? [];
    assert.ok(tile, 'the .pm-platform rule');
    assert.match(tile, /background: #fff;/);
    assert.match(tile, /border: 1px solid #e5e7eb;/);
    assert.match(tile, /border-radius: 0\.85rem;/);
  });

  test('every source is recorded in docs/trading-platform-logos.md', () => {
    const doc = read('docs/trading-platform-logos.md');
    for (const { src, alt } of logos()) {
      assert.ok(doc.includes(`\`public${src}\``), src);
      assert.ok(doc.includes(`| ${alt} |`), alt);
    }
  });
});
