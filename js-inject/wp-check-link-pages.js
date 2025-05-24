async function runSitemapUsageAnalyzer() {
  const origin_url = window.location.origin;
  const page_sitemap = origin_url + '/page-sitemap.xml';
  const sitedata = [];

  try {
    const response = await fetch(page_sitemap);
    if (!response.ok) throw new Error('Sitemap not found.');
    const xmlText = await response.text();

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    const errorNode = xmlDoc.querySelector('parsererror');
    if (errorNode) throw new Error('Error parsing XML sitemap.');

    const links = xmlDoc.querySelectorAll('loc');
    links.forEach(link => {
      const url = link.textContent.trim().replace(/\/$/, '');
      if (!url.includes('wp-content')) {
        sitedata.push({
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
        });
      }
    });

    await crawlEntireSite(sitedata);
  } catch (error) {
    console.error('Error fetching or parsing sitemap:', error);
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

    console.log('✅ Crawl complete. Site usage data:');
    console.table(sitedata.map(p => ({
      URL: p.url,
      Status: p.status,
      Title: p.title,
      UsedCount: p.usedCount,
      LinkedBy: Object.keys(p.usedByPages).length
    })));

    window.sitemapUsageResult = sitedata;
    openSummaryTab(sitedata);
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

      // Extract metadata
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

  function openSummaryTab(sitedata) {
    const newWindow = window.open('', '_blank');
    if (!newWindow) {
      alert('Popup blocked. Please allow popups for this site.');
      return;
    }

    const summaryHtml = `
      <html>
      <head>
        <title>Sitemap Usage Summary</title>
        <style>
          body { font-family: Arial; padding: 30px; background: #f9f9f9; color: #333; }
          h1, h2 { color: #007acc; }
          .summary-box { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 30px; }
          .url-entry { background: #fff; border-left: 5px solid #007acc; margin-bottom: 16px; padding: 16px; border-radius: 6px; }
          .url-entry p { margin: 4px 0; }
          .status-ok { color: green; }
          .status-error { color: red; }
          .used-by { font-size: 0.9em; color: #555; margin-top: 10px; }
          ul { padding-left: 20px; }
          button { padding: 10px 16px; font-size: 14px; background: #007acc; border: none; color: white; border-radius: 4px; cursor: pointer; }
        </style>
      </head>
      <body>
        <h1>Sitemap Crawl & Usage Summary</h1>
        <div class="summary-box">
          <p><strong>Total Pages:</strong> ${sitedata.length}</p>
          <p><strong>Linked Pages:</strong> ${sitedata.filter(d => d.usedCount > 0).length}</p>
          <p><strong>Unlinked Pages:</strong> ${sitedata.filter(d => d.usedCount === 0).length}</p>
          <p><strong>Error Pages:</strong> ${sitedata.filter(d => d.status !== 'OK').length}</p>
          <button onclick="(${exportToCSV.toString()})()">Export CSV</button>
        </div>
        <h2>Page Details</h2>
        ${sitedata.map(item => `
          <div class="url-entry">
            <p><strong>URL:</strong> <a href="${item.url}" target="_blank">${item.url}</a></p>
            <p><strong>Title:</strong> ${item.title}</p>
            <p><strong>Status:</strong> <span class="${item.status === 'OK' ? 'status-ok' : 'status-error'}">${item.status} (${item.statusCode})</span></p>
            <p><strong>Word Count:</strong> ${item.wordCount}</p>
            <p><strong>Internal Links:</strong> ${item.internalLinks} | <strong>External Links:</strong> ${item.externalLinks}</p>
            <p><strong>Meta Description:</strong> ${item.metaDescription || '<em>None</em>'}</p>
            <p><strong>Canonical:</strong> ${item.canonical || '<em>None</em>'}</p>
            <p><strong>Usage Count:</strong> ${item.usedCount}</p>
            ${Object.keys(item.usedByPages).length ? `
              <div class="used-by">
                <strong>Used by:</strong>
                <ul>${Object.entries(item.usedByPages).map(([url, count]) =>
                  `<li><a href="${url}" target="_blank">${url}</a> (${count})</li>`).join('')}
                </ul>
              </div>` : '<p><em>Not linked from any page.</em></p>'}
          </div>`).join('')}
      </body>
      </html>
    `;

    newWindow.document.write(summaryHtml);
    newWindow.document.close();
  }

  function exportToCSV() {
    const data = window.sitemapUsageResult || [];
    const rows = [
      ['URL', 'Title', 'Status', 'StatusCode', 'WordCount', 'InternalLinks', 'ExternalLinks', 'UsedCount', 'LinkedBy', 'MetaDescription', 'Canonical'],
      ...data.map(item => [
        item.url,
        item.title,
        item.status,
        item.statusCode,
        item.wordCount,
        item.internalLinks,
        item.externalLinks,
        item.usedCount,
        Object.keys(item.usedByPages).length,
        item.metaDescription,
        item.canonical
      ])
    ];
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'sitemap-usage-crawl-data.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Ctrl + Shift + U
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'u') {
    e.preventDefault();
    runSitemapUsageAnalyzer();
  }
});
