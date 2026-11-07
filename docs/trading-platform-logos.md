# Trading platform logos

The **Supported Trading Platforms** section of the downloads page shows these logos. They're stored in
`public/brands/` and served from the site itself, never from another site or CDN. Each logo and name is a
trademark of its owner. The page says HoppLink is independent and not affiliated with or endorsed by them.

| Platform | File | Source | Notes |
|---|---|---|---|
| Polymarket | `public/brands/polymarket.svg` | Polymarket's brand page, polymarket.com/brand: `polymarket-logos.zip`, `logo-black.svg` | Official kit. The black wordmark is the version for light backgrounds. |
| Binance | `public/brands/binance.svg` | Wikimedia Commons, `File:Binance_logo.svg` | binance.com refused automated requests, and its Style Guide couldn't be reached. Matches Binance's current wordmark. |
| BingX | `public/brands/bingx.svg` | bingx.com, the logo in the site's footer | Served by BingX itself. It's their single-colour (black) wordmark. No public brand kit was found. |
| Bybit | `public/brands/bybit.svg` | Wikimedia Commons, `File:Bybit_Logo.svg` | No public brand kit was found, and bybit.com draws its logo in script. Bybit refreshed its brand in 2025, so check this against Bybit's current logo. |
| HTX | `public/brands/htx.png` | Wikimedia Commons, `File:HTX_logo.png` (credited to htx.com) | No SVG or brand kit was found. 374 × 144, transparent. |
| Kalshi | `public/brands/kalshi.svg` | Wikimedia Commons, `File:Kalshi-logo-2026.svg`, taken from Kalshi's brand kit at kalshi.com/brandkit | kalshi.com refused automated requests. Kalshi's guidelines: don't stretch, crop, recolour or add effects. |
| OKX | `public/brands/okx.svg` | Wikimedia Commons, `File:OKX_logo.svg` (credited to okx.com) | okx.com only serves a small PNG of its logo. |
| Pionex | `public/brands/pionex.png` | pionex.us, the site's own `static/media/logo.737aa1fe.png` | pionex.com refused automated requests. This is the global wordmark, not the "United States of America" version. 378 × 66, transparent. |

**Not added:** Kashi, until the platform is identified.

## How the files were prepared

Nothing was redrawn or recoloured.

- **SVGs:** kept only drawing elements (paths, shapes, groups, gradients, clip paths and their styles) and their
  presentation attributes. Removed editor metadata, comments, the DOCTYPE and anything that could run or load
  something else. The `viewBox` is unchanged.
- **PNGs:** trimmed any fully transparent margin.

The page gives each logo the same height (`.pm-platform-logo` in `src/styles.css`) and lets its width follow, so every
logo keeps its proportions. Each `<img>` has the file's aspect ratio in its `width` and `height` attributes, so the
browser reserves the right space before the image loads. `tests/trading-platforms.test.js` checks that.

To replace a logo with a newer official one, prepare it the same way, keep the file name, and update the tag's
`width` and `height` if the proportions change.
