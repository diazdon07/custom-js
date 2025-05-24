const origin_url = window.location.origin;
const sitemapIndexUrl = origin_url + '/sitemap_index.xml';

async function fetchXml(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch XML from ${url}`);
  const text = await response.text();
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, "application/xml");
  if (xmlDoc.querySelector('parsererror')) {
    throw new Error(`Error parsing XML from ${url}`);
  }
  return xmlDoc;
}

async function extractUrlsFromSitemap(sitemapUrl) {
  const xmlDoc = await fetchXml(sitemapUrl);
  const locElements = xmlDoc.querySelectorAll("url > loc");
  return Array.from(locElements)
    .map(el => el.textContent.trim())
    .filter(url => !url.includes('wp-content'))
    .map(url => url.replace(/\/$/, ''));
}

async function getSitemapsWithUrlsArrayGrouped(indexUrl) {
  const indexXml = await fetchXml(indexUrl);
  const sitemapUrls = Array.from(indexXml.querySelectorAll("sitemap > loc")).map(el => el.textContent.trim());

  const sitemapGroups = [];

  for (const sitemapUrl of sitemapUrls) {
    try {
      const urls = await extractUrlsFromSitemap(sitemapUrl);
      sitemapGroups.push({
        sitemapUrl,
        urls,
        sitedata: urls.map(url => ({
          url,
          usedCount: 0,
          usedByPages: {},
          status: 'Pending',
          statusCode: null,
          title: '',
          metaDescription: '',
          canonical: '',
          internalLinks: 0,
          externalLinks: 0,
          wordCount: 0
        }))
      });
    } catch (err) {
      console.error(`Failed to fetch URLs from ${sitemapUrl}`, err);
    }
  }

  sitemapGroups.sort((a, b) => {
    const aName = (a.sitemapUrl.match(/\/([\w\-]+)\.xml$/) || [])[1] || a.sitemapUrl;
    const bName = (b.sitemapUrl.match(/\/([\w\-]+)\.xml$/) || [])[1] || b.sitemapUrl;
    return aName.localeCompare(bName);
  });

  return sitemapGroups;
}

async function runSitemapUsageAnalyzer() {
  try {
    const sitemapGroups = await getSitemapsWithUrlsArrayGrouped(sitemapIndexUrl);

    for (const group of sitemapGroups) {
      await crawlEntireSite(group.sitedata);
    }

    window.sitemapGroups = sitemapGroups;
    openSummaryAccordion(sitemapGroups);
  } catch (error) {
    console.error('Error fetching or parsing sitemap:', error);
  }
}

async function crawlEntireSite(sitedata) {
  const batchSize = 3;
  const delayBetweenBatches = 500;
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (let i = 0; i < sitedata.length; i += batchSize) {
    const batch = sitedata.slice(i, i + batchSize);
    await Promise.all(batch.map(entry => fetchAndAnalyzePage(entry, sitedata)));
    await delay(delayBetweenBatches);
  }
}

async function fetchAndAnalyzePage(pageEntry, sitedata) {
  try {
    const response = await fetch(pageEntry.url, { method: 'GET' });
    pageEntry.status = response.ok ? 'OK' : 'Error';
    pageEntry.statusCode = response.status;

    if (!response.ok) return;

    const html = await response.text();
    const parser = new DOMParser();
    let doc;
    try {
      doc = parser.parseFromString(html, 'text/html');
    } catch {
      return;
    }

    pageEntry.title = doc.querySelector('title')?.innerText || '';
    pageEntry.metaDescription = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    pageEntry.canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';

    const links = Array.from(doc.querySelectorAll('a[href]'));
    const bodyText = doc.body?.innerText || '';
    pageEntry.wordCount = bodyText.trim().split(/\s+/).length;

    links.forEach(link => {
      let href = link.href.split('#')[0].replace(/\/$/, '');
      try {
        const url = new URL(href);
        if (url.origin === origin_url) {
          pageEntry.internalLinks += 1;
          const target = sitedata.find(item => item.url === href);
          if (target) {
            target.usedCount += 1;
            if (!target.usedByPages[pageEntry.url]) {
              target.usedByPages[pageEntry.url] = 1;
            } else {
              target.usedByPages[pageEntry.url] += 1;
            }
          }
        } else {
          pageEntry.externalLinks += 1;
        }
      } catch {}
    });
  } catch (err) {
    pageEntry.status = 'Error';
    pageEntry.statusCode = err.message;
  }
}

function openSummaryAccordion(sitemapGroups) {
  const newWindow = window.open('', '_blank');
  if (!newWindow) {
    alert('Popup blocked. Please allow popups for this site.');
    return;
  }

  const accordionHtml = sitemapGroups.map((group, i) => {
    const sitemapNameMatch = group.sitemapUrl.match(/\/([\w\-]+)\.xml$/);
    const sitemapName = sitemapNameMatch ? sitemapNameMatch[1] : group.sitemapUrl;

    const total = group.sitedata.length;
    const linkedPages = group.sitedata.filter(d => d.usedCount > 0);
    const unlinkedPages = group.sitedata.filter(d => d.usedCount === 0);
    const errors = group.sitedata.filter(d => d.status !== 'OK').length;

    const sortUrls = arr => arr.slice().sort((a, b) => a.url.localeCompare(b.url));

    return `
    <details ${i === 0 ? 'open' : ''} style="margin-bottom: 15px; border:1px solid #ccc; border-radius:6px; padding: 10px;">
      <summary style="font-weight:bold; cursor:pointer; font-size: 1.2em; color:#007acc;">
        ${sitemapName} — Total: ${total}, Linked: ${linkedPages.length}, Unlinked: ${unlinkedPages.length}, Errors: ${errors}
      </summary>

      <h3 style="margin-top: 15px; color: #2c3e50;">Active Links (${linkedPages.length})</h3>
      <ul style="max-height: 200px; overflow-y: auto; padding-left: 20px; font-family: monospace; font-size: 0.9em; border: 1px solid #d1d1d1; border-radius: 4px; background: #e6ffed;">
        ${sortUrls(linkedPages).map(page => {
          return `<li>
            <a href="${page.url}" target="_blank" style="color: green; text-decoration:none;">${page.url}</a>
            ${page.status !== 'OK' ? ` - <strong>Status: ${page.status}</strong>` : ''}
          </li>`;
        }).join('')}
      </ul>

      <h3 style="margin-top: 15px; color: #7f8c8d;">Unlinked Pages (${unlinkedPages.length})</h3>
      <ul style="max-height: 200px; overflow-y: auto; padding-left: 20px; font-family: monospace; font-size: 0.9em; border: 1px solid #d1d1d1; border-radius: 4px; background: #ffecec;">
        ${sortUrls(unlinkedPages).map(page => {
          const statusColor = page.status === 'OK' ? '#333' : (page.status === 'Pending' ? 'gray' : 'red');
          return `<li>
            <a href="${page.url}" target="_blank" style="color:${statusColor}; text-decoration:none;">${page.url}</a>
            ${page.status !== 'OK' ? ` - <strong>Status: ${page.status}</strong>` : ''}
          </li>`;
        }).join('')}
      </ul>
    </details>
    `;
  }).join('\n');

  const summaryHtml = `
  <html>
  <head>
    <title>Sitemap Usage Summary Accordion</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f9f9f9; padding: 20px; color: #333; }
      a:hover { text-decoration: underline; }
      summary::-webkit-details-marker { color: #007acc; }
      summary { outline: none; }
      h3 { margin-bottom: 5px; }
    </style>
  </head>
  <body>
    <h1>Sitemap Crawl & Usage Summary (Grouped by Sitemap)</h1>
    ${accordionHtml}
  </body>
  </html>
  `;

  newWindow.document.write(summaryHtml);
  newWindow.document.close();
}

// Run with Ctrl+Shift+U
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'u') {
    e.preventDefault();
    runSitemapUsageAnalyzer();
  }
});
