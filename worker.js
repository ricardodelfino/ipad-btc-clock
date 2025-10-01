// --- Configuration ---
const CACHE_TTL_SECONDS = 60; // How long to cache the API results (in seconds)

// --- API Fetching Functions ---

/**
 * Fetches a spot price from the Coinbase public API.
 * @param {string} pair - The trading pair (e.g., 'BTC-USDC').
 * @returns {Promise<number|null>} The price as a number, or null on failure.
 */
async function fetchFromCoinbase(pair) {
  try {
    const response = await fetch(`https://api.coinbase.com/v2/prices/${pair}/spot`);

    if (!response.ok) {
      console.error(`Coinbase API responded with status: ${response.status} for pair ${pair}`);
      return null;
    }
    const data = await response.json();
    return parseFloat(data.data.amount);
  } catch (error) {
    console.error(`Failed to fetch from Coinbase API for pair ${pair}:`, error);
    return null;
  }
}

// --- HTML Generation Functions ---

/**
 * Generates the HTML for a digital placard display.
 * @param {number|null} price - The number to display.
 * @param {object} options - Formatting options.
 * @param {number} options.fractionDigits - Number of decimal places.
 * @returns {string} The HTML string for the placard.
 */
function generatePlacardHtml(price, options = { fractionDigits: 0 }) {
  if (price === null) {
    return '<span class="error-text">Error</span>';
  }

  const formattedNumberStr = price.toLocaleString('pt-BR', {
    minimumFractionDigits: options.fractionDigits,
    maximumFractionDigits: options.fractionDigits,
  });

  let html = '';
  for (let i = 0; i < formattedNumberStr.length; i++) {
    const char = formattedNumberStr[i];
    if (char === '.' || char === ',') {
      html += `<div class="separator-dot">${char}</div>`;
    } else {
      html += `<div class="digit-box">${char}</div>`;
    }
  }
  return html;
}

// --- Main Worker Logic ---

export default {
  /**
   * @param {Request} request
   * @param {object} env - Environment variables
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    // This is the worker's internal cache, separate from the browser/edge cache.
    const internalCache = caches.default;
    let response = await internalCache.match(request);

    if (!response) {
      console.log('Internal cache miss. Fetching fresh data from Coinbase...');

      const [btcUsdc, btcBrl] = await Promise.all([
        fetchFromCoinbase('BTC-USDC'),
        fetchFromCoinbase('BTC-BRL'),
      ]);

      const usdcBrl = (btcBrl && btcUsdc) ? btcBrl / btcUsdc : null;
      const allDataFetched = btcUsdc !== null && btcBrl !== null && usdcBrl !== null;

      const btcUsdcPlacard = generatePlacardHtml(btcUsdc, { fractionDigits: 0 });
      const usdcBrlPlacard = generatePlacardHtml(usdcBrl, { fractionDigits: 2 });
      const btcBrlPlacard = generatePlacardHtml(btcBrl, { fractionDigits: 0 });

      const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>BTC Panel</title>
          <meta http-equiv="refresh" content="${CACHE_TTL_SECONDS}">
          <meta name="apple-mobile-web-app-status-bar-style" content="black">
          <meta name="theme-color" content="#000000">
          <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;700&display=swap" rel="stylesheet">
          <style>
            html, body { margin: 0; padding: 0; background-color: #000; color: white; font-family: 'Poppins', sans-serif; width: 100vw; height: 100vh; overflow: hidden; }
            body { display: flex; flex-direction: column; height: 100vh; }
            .cell { flex: 1; display: flex; justify-content: center; align-items: center; border-top: 1px solid #222; padding: 8px; box-sizing: border-box; gap: 15px; }
            #btc-usdc-cell { border-top: none; }
            .digit-box { background-color: #0B0A0F; color: white; font-weight: 600; font-size: 138px; width: 102px; height: 170px; display: flex; justify-content: center; align-items: center; border-radius: 4px; box-shadow: 0 0 0 1px #9d9c9c, 0 0 0 3px #ad6218, inset 0 8px 12px rgba(0,0,0,0.8), inset 0 -8px 12px rgba(255,255,255,0.15); margin-right: 7px; margin-left: 7px; -webkit-transform: scaleY(1.1); -moz-transform: scaleY(1.1); -o-transform: scaleY(1.1); transform: scaleY(1.1);}
            .separator-dot { color: #e0e0e0; font-size: 63px; font-weight: 300; line-height: 168px; align-self: center; }
            .error-text { font-size: 50px; color: #ff4d4d; }
          </style>
        </head>
        <body>
          <div class="cell" id="btc-usdc-cell">${btcUsdcPlacard}</div>
          <div class="cell" id="usdc-brl-cell">${usdcBrlPlacard}</div>
          <div class="cell" id="btc-brl-cell">${btcBrlPlacard}</div>
        </body>
        </html>
      `;

      // *** CACHE-CONTROL FIX ***
      // Create headers that prevent browser/edge caching but allow our internal cache to work.
      const headers = {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        // Set a cache TTL for the internal cache on the response itself
        'X-Internal-Cache-TTL': CACHE_TTL_SECONDS
      };

      response = new Response(html, { headers });

      if (allDataFetched) {
        console.log('All data fetched successfully. Caching response internally.');
        // We must clone the response to be able to use it for the cache AND return it.
        // The body of a response can only be read once.
        let cacheableResponse = response.clone();
        await internalCache.put(request, cacheableResponse);
      } else {
        console.warn('One or more API calls failed. Response will not be cached.');
      }
    } else {
      console.log('Internal cache hit. Serving from internal cache.');
    }

    return response;
  },
};
