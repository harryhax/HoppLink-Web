# Desktop app screenshot

The product introduction at the top of the downloads page (`src/pages/downloads.js`, `data-intro`) shows a screenshot
of the HoppLink desktop app beside its text.

**Location:** `public/images/hopplink-app.png`, served at `/images/hopplink-app.png`.

**Current file:** the desktop app (v0.1.5, dark theme), connected to Sweden. 1736 × 1322 pixels, about 265 KB. It
was saved losslessly as RGB (its alpha channel was fully opaque) with only its colour profile kept; EXIF and XMP
metadata were removed.

The page shows the image only once it has really loaded as an image. If the file were missing, its column would stay
hidden and the introduction's text would use the full width, rather than showing a broken image (Nginx answers a
missing file with the site's HTML page).

## Replacing it

1. Use a screenshot of the real desktop app window (not of this website or its downloads page), with no personal
   details: no real email address, username, API key or PAC URL.
2. Save it as a PNG, trimmed to the window, about 1200 to 1600 pixels wide. Optimise it losslessly (for example
   `oxipng -o 4 --strip safe` or `pngcrush`) to at most 600 KB.
3. Put it at `public/images/hopplink-app.png`.
4. Add its real `width` and `height` to the `<img class="pm-app-screenshot">` tag, so the browser reserves the right
   space before it loads. The CSS (`.pm-app-screenshot` in `src/styles.css`) scales it to the column with
   `height: auto`, so it keeps its proportions.
5. Check that the `alt` text still describes what the screenshot shows.

`tests/product-intro.test.js` checks the file once it's there: a real PNG, the size limit, and `width`/`height`
attributes matching its proportions.
