async function runSitemapUsageAnalyzer() {
  const origin_url = window.location.origin;
  const page_sitemap = origin_url + '/page-sitemap.xml';
  //const page_sitemap = origin_url + '/wp-sitemap-posts-page-1.xml';

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
      const url = link.textContent.trim();
      if (!url.includes('wp-content')) {
        sitedata.push({ url, usedCount: 0, usedByPages: {} });
      }
    });
    check_actual_displayed_page();
  } catch (error) {
    console.error('Error fetching or parsing sitemap:', error);
  }

  async function check_actual_displayed_page() {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const batchSize = 5;
    const delayBetweenBatches = 200;

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < links.length; i += batchSize) {
      const batchLinks = links.slice(i, i + batchSize);
      await processBatch(batchLinks);
      await delay(delayBetweenBatches);
    }

    async function processBatch(batchLinks) {
      const fetchPromises = batchLinks.map(async (link) => {
        try {
          const response = await fetch(link.href, { method: 'GET' });
          const statusCode = response.status;

          if (response.ok) {
            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            const docs_links = doc.querySelectorAll('a[href]');

            docs_links.forEach((doc_link) => {
              const doc_url = doc_link.href;
              const doc_entry = sitedata.find(item => item.url === doc_url);
              if (doc_entry) {
                doc_entry.usedCount += 1;
                if (!doc_entry.usedByPages[link.href]) {
                  doc_entry.usedByPages[link.href] = 1;
                } else {
                  doc_entry.usedByPages[link.href] += 1;
                }
              }
            });
          }

          const index = sitedata.findIndex(item => item.url === link.href);
          if (index !== -1) {
            sitedata[index].status = response.ok ? 'OK' : 'Error';
            sitedata[index].statusCode = statusCode;
          }

        } catch (error) {
          const index = sitedata.findIndex(item => item.url === link.href);
          if (index !== -1) {
            sitedata[index].status = 'Error';
            sitedata[index].statusCode = error.message;
          }
        }
      });

      await Promise.all(fetchPromises);
    }

    console.log('Final sitedata with usage counts and referring pages:', sitedata);
    openSummaryTab();
  }

  function openSummaryTab() {
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
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 40px;
            background-color: #f9f9f9;
            color: #333;
          }
          h1 {
            font-size: 28px;
            margin-bottom: 10px;
          }
          h2 {
            font-size: 20px;
            margin-top: 30px;
            border-bottom: 2px solid #ddd;
            padding-bottom: 5px;
          }
          .summary-box {
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
            padding: 20px;
            margin-bottom: 20px;
          }
          .url-entry {
            background: #fff;
            border-left: 4px solid #007acc;
            padding: 16px;
            margin-bottom: 16px;
            border-radius: 6px;
          }
          .url-entry p {
            margin: 4px 0;
          }
          .status-ok {
            color: green;
          }
          .status-error {
            color: red;
          }
          a {
            color: #007acc;
            text-decoration: none;
          }
          a:hover {
            text-decoration: underline;
          }
          .used-by {
            font-size: 0.95em;
            color: #555;
            margin-top: 8px;
            padding-left: 16px;
          }
          .used-by li {
            margin: 4px 0;
          }
        </style>
      </head>
      <body>
        <h1>Sitemap Usage Summary</h1>

        <div class="summary-box">
          <p><strong>Total Pages in Sitemap:</strong> ${sitedata.length}</p>
          <p><strong>Pages Actually Used:</strong> ${sitedata.filter(d => d.usedCount > 0).length}</p>
          <p><strong>Pages Not Linked Anywhere:</strong> ${sitedata.filter(d => d.usedCount === 0).length}</p>
          <p><strong>Pages With Errors:</strong> ${sitedata.filter(d => d.status !== 'OK').length}</p>
        </div>

        <h2>Details</h2>

        ${sitedata.map(item => `
          <div class="url-entry">
            <p><strong>URL:</strong> <a href="${item.url}" target="_blank">${item.url}</a></p>
            <p><strong>Status:</strong> <span class="${item.status === 'OK' ? 'status-ok' : 'status-error'}">
              ${item.status || 'N/A'} (${item.statusCode || '—'})
            </span></p>
            <p><strong>Usage Count:</strong> ${item.usedCount}</p>
            ${Object.keys(item.usedByPages).length > 0 ? `
              <div class="used-by">
                <p><strong>Used by Identify Url:</strong></p>
                <ul>
                  ${Object.entries(item.usedByPages)
                    .map(([referrer, count]) => `<li><a href="${referrer}" target="_blank">${referrer}</a> (${count})</li>`)
                    .join('')}
                </ul>
              </div>
            ` : '<p><em>Not linked from any page.</em></p>'}
          </div>
        `).join('')}
      </body>
      </html>
    `;

    newWindow.document.write(summaryHtml);
    newWindow.document.close();
  }
}

// Hotkey listener: Ctrl + Shift + U
document.addEventListener('keydown', function (e) {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'u') {
    e.preventDefault();
    runSitemapUsageAnalyzer();
  }
});