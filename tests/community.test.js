// The HoppLink Discord invitation: defined once, linked from the downloads page's header and its community section,
// always opening in a new tab, with Discord's official symbol served from this site. Run with: npm test
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DISCORD_INVITE_URL } from '../src/community.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const sources = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? sources(join(dir, e.name))
  : /\.(js|css|html)$/.test(e.name) ? [join(dir, e.name)] : []));

const page = read('src/pages/downloads.js');
const ICON = '/community/discord-symbol.svg';
/** The <a> tags marked as Discord links. */
const discordLinks = () => [...page.matchAll(/<a\b[^>]*data-discord-link[^>]*>[\s\S]*?<\/a>/g)].map(([tag]) => tag);

describe('the invitation', () => {
  test('is the official HoppLink Discord invitation', () => {
    assert.equal(DISCORD_INVITE_URL, 'https://discord.gg/AmyFRbT8ee');
  });

  test('is written once, in src/community.js, and every link uses it', () => {
    for (const file of ['index.html', ...sources('src')]) {
      const mentions = (read(file).match(/discord\.gg\//gi) ?? []).length;
      assert.equal(mentions, file === join('src', 'community.js') ? 1 : 0, file);
    }
    assert.match(page, /import \{ DISCORD_INVITE_URL \} from '\.\.\/community\.js';/);
  });
});

describe('the downloads page', () => {
  test('links to Discord from the header and from the community section', () => {
    const links = discordLinks();
    assert.equal(links.length, 2);
    const [header, community] = links;

    assert.ok(page.indexOf(header) < page.indexOf('</header>'), 'the first is in the header');
    assert.match(header, /Join Discord/);
    assert.ok(header.includes(`src="${ICON}"`), 'with the Discord icon');
    assert.match(header, /aria-label="Join Discord \(opens in a new tab\)"/);

    const section = page.match(/<section class="card[^"]*" aria-labelledby="pm-community-title" data-community>[\s\S]*?<\/section>/)?.[0];
    assert.ok(section, 'the community section');
    assert.match(section, /<h2 [^>]*id="pm-community-title">Join the HoppLink Community<\/h2>/);
    assert.ok(section.includes(community));
    assert.match(community, />Join Discord</);
    assert.ok(section.includes(`src="${ICON}"`));
    assert.match(section, /alt="Discord"/);
  });

  test('opens the invitation in a new tab, without giving Discord access to the page', () => {
    for (const link of discordLinks()) {
      assert.match(link, /href="\$\{DISCORD_INVITE_URL\}"/, link);
      assert.match(link, /target="_blank"/, link);
      assert.match(link, /rel="noopener noreferrer"/, link);
    }
  });

  test('keeps Sign in, and the community section sits below the downloads', () => {
    assert.match(page, /<a class="btn btn-outline-secondary btn-sm" href="\/login">Sign in<\/a>/);
    assert.ok(page.indexOf('data-ready') < page.indexOf('data-community'));
    assert.ok(page.indexOf('data-community') < page.indexOf('HoppLink is beta software.'));
  });

  test('stays usable on phones: the header keeps the icon, and the section stacks', () => {
    const [header] = discordLinks();
    assert.match(header, /<span class="d-none d-sm-inline">Join Discord<\/span>/);
    assert.match(page, /class="card-body p-4 d-flex flex-column flex-sm-row align-items-center gap-3/);
  });
});

describe('the icon', () => {
  const svg = read(join('public', ICON));
  const styles = read('src/styles.css');

  test("is Discord's official symbol, unchanged, in Blurple", () => {
    assert.match(svg, /viewBox="0 0 126\.644 96"/);
    assert.match(svg, /fill:#5865f2;/);
    assert.match(svg, /id="Discord-Symbol-Blurple"/);
  });

  test('only draws: no scripts, links or outside resources', () => {
    assert.doesNotMatch(svg, /<script|javascript:|href|\son[a-z]+=|<image|<foreignObject|@import|url\(|<!DOCTYPE|<!ENTITY/i);
  });

  test('keeps its proportions and colour wherever it is shown', () => {
    for (const tag of page.match(/<img\b[^>]*discord-symbol[^>]*>/g)) {
      assert.match(tag, /width="127" height="96"/, tag); // the symbol's aspect ratio
    }
    for (const name of ['pm-discord-icon', 'pm-community-icon']) {
      const rule = styles.match(new RegExp(`\\.${name} \\{([^}]*)\\}`))?.[1];
      assert.ok(rule, name);
      assert.match(rule, /width: auto;/);
      assert.doesNotMatch(rule, /filter|opacity/);
    }
  });
});
