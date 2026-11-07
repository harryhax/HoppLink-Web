// The official HoppLink logo and icons: every reference resolves to a file in public/ (copied to the site root by Vite),
// the logo is the one made for the site's light backgrounds and is never stretched or recoloured, and the favicons are
// valid. Images are checked from their PNG and ICO headers, so no browser is needed. Run with: npm test
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const bytes = (path) => readFileSync(join(ROOT, path));
const sources = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? sources(join(dir, e.name))
  : /\.(js|css)$/.test(e.name) ? [join(dir, e.name)] : []));
/** The public file a site path is served from. */
const publicFile = (sitePath) => join('public', sitePath.replace(/^\//, ''));

const LOGO = '/brand/hopplink-logo-on-light.png';
const PAGES_WITH_LOGO = ['login', 'register', 'downloads', 'account', 'admin-shell'];

/** Width, height and colour type from a PNG's IHDR chunk. */
function png(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'a PNG');
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colourType: buffer[25] };
}

/** Every <img> tag in the application's pages. */
const imageTags = () => sources('src').flatMap((file) => (read(file).match(/<img\b[^>]*>/g) ?? []).map((tag) => ({ file, tag })));
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

describe('the logo', () => {
  test('replaces the placeholder in every page that showed it', () => {
    for (const page of PAGES_WITH_LOGO) {
      assert.ok(read(`src/pages/${page}.js`).includes(`src="${LOGO}"`), page);
    }
    for (const file of ['index.html', ...sources('src')]) {
      assert.doesNotMatch(read(file), /favicon\.svg/, file);
    }
    assert.equal(existsSync(join(ROOT, 'public/favicon.svg')), false, 'the placeholder globe is gone');
  });

  test('every image path resolves to a file in the repository, never a remote or outside address', () => {
    const tags = imageTags();
    assert.ok(tags.length >= PAGES_WITH_LOGO.length);
    for (const { file, tag } of tags) {
      const src = attribute(tag, 'src');
      assert.match(src, /^\/[a-z0-9/_.-]+$/, `${file}: ${tag}`);
      assert.ok(existsSync(join(ROOT, publicFile(src))), `${file}: ${src} is in public/`);
    }
    for (const file of ['index.html', ...sources('src')]) {
      assert.doesNotMatch(read(file), /sample_images|file:\/\//, file);
    }
  });

  test('is the official artwork for light backgrounds: transparent, small, and in its own proportions', () => {
    const file = bytes(publicFile(LOGO));
    const { width, height, colourType } = png(file);
    assert.equal(colourType, 6, 'RGBA, with a transparent background');
    assert.equal(height, 120, 'sharp at 3x the largest size shown (2rem)');
    assert.ok(width / height > 5 && width / height < 7, 'the wordmark is about six times as wide as it is tall');
    assert.ok(file.length < 100 * 1024, `${file.length} bytes`);

    // The width and height on each tag are the file's, so the browser reserves the right shape before it loads.
    for (const { file: page, tag } of imageTags().filter(({ tag }) => tag.includes(LOGO))) {
      assert.equal(Number(attribute(tag, 'width')), width, page);
      assert.equal(Number(attribute(tag, 'height')), height, page);
      assert.equal(attribute(tag, 'alt'), 'HoppLink', `${page}: the logo is named for screen readers`);
      assert.match(attribute(tag, 'class'), /^pm-logo( pm-logo-(sm|md))?$/, page);
    }
  });

  test('replaces the name beside it, rather than repeating it', () => {
    for (const page of PAGES_WITH_LOGO) {
      const source = read(`src/pages/${page}.js`);
      assert.doesNotMatch(source, /<span[^>]*>HoppLink<\/span>/, page);
      assert.doesNotMatch(source, /alt="HoppLink"[^>]*>HoppLink/, page);
    }
  });

  test('is sized by height only, never stretched, and never recoloured with a filter', () => {
    const styles = read('src/styles.css');
    const [, rule] = styles.match(/\.pm-logo \{([^}]*)\}/) ?? [];
    assert.ok(rule, 'the .pm-logo rule');
    assert.match(rule, /width: auto;/);
    assert.match(rule, /height: 2rem;/);
    assert.match(rule, /object-fit: contain;/, 'kept in proportion even when its container is narrower');
    assert.match(styles, /\.pm-logo-md \{ height: 1\.75rem; \}/);
    assert.match(styles, /\.pm-logo-sm \{ height: 1\.5rem; \}/);
    assert.doesNotMatch(styles, /\.pm-logo[^{]*\{[^}]*(?<![-\w])width: \d/, 'no fixed width (max-width: 100% only stops it overflowing)');
    for (const file of sources('src')) {
      assert.doesNotMatch(read(file), /\bfilter\s*:|invert\(|brightness\(|hue-rotate\(/, file);
    }
  });
});

describe('light and dark backgrounds', () => {
  test('the site is light only, so every logo is the light-background variant', () => {
    assert.match(read('index.html'), /<meta name="color-scheme" content="light" \/>/);
    for (const file of ['index.html', ...sources('src')]) {
      const source = read(file);
      assert.doesNotMatch(source, /data-bs-theme="dark"|prefers-color-scheme:\s*dark|bg-dark|navbar-dark|text-bg-dark/, file);
      assert.doesNotMatch(source, /logo-on-dark/, file);
    }
    for (const { tag } of imageTags()) {
      if (/hopplink-logo/.test(tag)) assert.ok(tag.includes(LOGO), tag);
    }
  });

  test('the logo sits only on light surfaces', () => {
    // Login, registration and downloads cards are white; the navbars are bg-white; the sidebar is #fff.
    assert.match(read('src/pages/account.js'), /<nav class="navbar bg-white[^"]*">\s*<span class="navbar-brand py-0"><img class="pm-logo/);
    assert.match(read('src/pages/downloads.js'), /<header class="bg-white border-bottom">/);
    assert.match(read('src/styles.css'), /\.pm-sidebar \{[^}]*background: #fff;/);
  });

  test('only the light variant is shipped, as there is nowhere to show the dark one', () => {
    assert.deepEqual(readdirSync(join(ROOT, 'public/brand')), ['hopplink-logo-on-light.png']);
  });
});

describe('favicons', () => {
  const head = read('index.html');
  const links = [...head.matchAll(/<link rel="(icon|apple-touch-icon)"[^>]*>/g)].map(([tag, rel]) => ({ tag, rel, href: attribute(tag, 'href') }));

  test('index.html links the .ico, a high-resolution PNG and the Apple touch icon, and each file exists', () => {
    assert.deepEqual(links.map((l) => l.href), ['/favicon.ico', '/icon-192.png', '/apple-touch-icon.png']);
    for (const { href } of links) assert.ok(existsSync(join(ROOT, publicFile(href))), href);
    assert.match(links[0].tag, /sizes="16x16 32x32 48x48"/);
    assert.match(links[1].tag, /type="image\/png" sizes="192x192"/);
    assert.equal(links[2].rel, 'apple-touch-icon');
  });

  test('favicon.ico holds 16, 32 and 48 pixel images', () => {
    const ico = bytes('public/favicon.ico');
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1, 'an icon');
    const sizes = [];
    for (let i = 0; i < ico.readUInt16LE(4); i += 1) {
      const entry = 6 + 16 * i;
      const size = ico[entry] || 256;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const image = png(ico.subarray(offset, offset + length));
      assert.deepEqual([image.width, image.height, image.colourType], [size, size, 6]);
      sizes.push(size);
    }
    assert.deepEqual(sizes, [16, 32, 48]);
    assert.ok(ico.length < 20 * 1024);
  });

  test('the PNG icons have the sizes their links declare; the touch icon is opaque, as iOS needs', () => {
    assert.deepEqual(png(bytes('public/icon-192.png')), { width: 192, height: 192, colourType: 6 });
    assert.deepEqual(png(bytes('public/apple-touch-icon.png')), { width: 180, height: 180, colourType: 2 });
    for (const file of ['public/icon-192.png', 'public/apple-touch-icon.png']) {
      assert.ok(statSync(join(ROOT, file)).size < 40 * 1024, file);
    }
  });

  test('Vite copies public/ to the site root, and Nginx serves those files as they are', () => {
    assert.doesNotMatch(read('vite.config.js'), /publicDir/);
    assert.match(read('deploy/central/nginx-web-locations.conf'), /location \/ \{\n {4}try_files \$uri \/index\.html;/);
  });
});

describe('the layout around the logo is unchanged', () => {
  test('the admin sidebar keeps its Admin badge and responsive visibility, and the mobile bars show the logo', () => {
    const shell = read('src/pages/admin-shell.js');
    assert.match(shell, /<div class="pm-sidebar-brand d-none d-lg-flex"><img class="pm-logo pm-logo-sm" [^>]*><span class="badge[^"]*">Admin<\/span><\/div>/);
    assert.match(shell, /<div class="offcanvas-header border-bottom d-lg-none">\s*<img class="pm-logo pm-logo-sm" [^>]*>\s*<button type="button" class="btn-close"/);
    assert.match(shell, /<span class="navbar-brand d-lg-none me-auto py-0"><img class="pm-logo pm-logo-sm" [^>]*><\/span>/);
  });

  test('sign-in and registration keep their forms under the logo', () => {
    for (const page of ['login', 'register']) {
      const source = read(`src/pages/${page}.js`);
      assert.match(source, /<div class="mb-4">\s*<img class="pm-logo" [^>]*>\s*<\/div>\s*<h1 class="h5/, page);
      assert.match(source, /<form novalidate/, page);
    }
  });

  test('the downloads header still links home to /downloads, with Join Discord and Sign in on the right', () => {
    assert.match(read('src/pages/downloads.js'), /href="\/downloads">\s*<img class="pm-logo pm-logo-md" [^>]*>\s*<\/a>\s*<div class="d-flex align-items-center gap-2">\s*<a [^>]*data-discord-link>[\s\S]*?<\/a>\s*<a class="btn btn-outline-secondary btn-sm" href="\/login">Sign in<\/a>\s*<\/div>/);
  });
});
