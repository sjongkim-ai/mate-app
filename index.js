const http = require('http');
const mysql = require('mysql2/promise');

const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'tmate',
  password: '!@jpascal4',
  database: 'tripmate',
  ssl: false,
};

const port = process.env.PORT || 3000;

async function checkDatabase() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [rows] = await connection.query(
      'SELECT DATABASE() AS databaseName, CURRENT_USER() AS currentUser, VERSION() AS version'
    );

    return rows[0];
  } finally {
    await connection.end();
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderStatusPage(result) {
  const isConnected = result.status === 'ok';
  const title = isConnected ? 'MariaDB Connected' : 'MariaDB Connection Failed';
  const badgeText = isConnected ? 'Connected' : 'Error';
  const badgeClass = isConnected ? 'success' : 'danger';
  const checkedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const detailRows = isConnected
    ? [
        ['Database', result.database.databaseName],
        ['User', result.database.currentUser],
        ['Version', result.database.version],
        ['Host', dbConfig.host],
        ['Port', dbConfig.port],
      ]
    : [
        ['Host', dbConfig.host],
        ['Port', dbConfig.port],
        ['Database', dbConfig.database],
        ['Error', result.message],
      ];

  const rowsHtml = detailRows
    .map(
      ([label, value]) => `
        <div class="detail-row">
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>`
    )
    .join('');

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DB Connection Check</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --panel: #ffffff;
      --text: #1d2733;
      --muted: #637083;
      --line: #d9e0ea;
      --success: #117a48;
      --success-bg: #e9f8f0;
      --danger: #b3261e;
      --danger-bg: #fdeceb;
      --accent: #2457c5;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, Helvetica, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: grid;
      place-items: center;
      padding: 24px;
    }

    main {
      width: min(100%, 720px);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 18px 45px rgba(29, 39, 51, 0.08);
      overflow: hidden;
    }

    header {
      padding: 28px 32px 22px;
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: clamp(24px, 4vw, 34px);
      line-height: 1.15;
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.55;
    }

    .badge {
      flex: 0 0 auto;
      min-width: 104px;
      padding: 8px 12px;
      border-radius: 999px;
      text-align: center;
      font-weight: 700;
      font-size: 14px;
      border: 1px solid currentColor;
    }

    .badge.success {
      color: var(--success);
      background: var(--success-bg);
    }

    .badge.danger {
      color: var(--danger);
      background: var(--danger-bg);
    }

    section {
      padding: 26px 32px 32px;
    }

    dl {
      margin: 0;
      display: grid;
      gap: 12px;
    }

    .detail-row {
      min-height: 48px;
      display: grid;
      grid-template-columns: minmax(120px, 180px) 1fr;
      align-items: center;
      gap: 16px;
      padding: 12px 0;
      border-bottom: 1px solid var(--line);
    }

    .detail-row:last-child {
      border-bottom: 0;
    }

    dt {
      color: var(--muted);
      font-weight: 700;
    }

    dd {
      margin: 0;
      overflow-wrap: anywhere;
      font-family: Consolas, Monaco, monospace;
      font-size: 15px;
    }

    .actions {
      margin-top: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    a,
    button {
      appearance: none;
      border: 1px solid var(--accent);
      background: var(--accent);
      color: #fff;
      border-radius: 6px;
      padding: 10px 14px;
      font: inherit;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
    }

    .checked-at {
      color: var(--muted);
      font-size: 14px;
    }

    @media (max-width: 560px) {
      header,
      section {
        padding-left: 20px;
        padding-right: 20px;
      }

      header {
        display: grid;
      }

      .badge {
        width: fit-content;
      }

      .detail-row {
        grid-template-columns: 1fr;
        gap: 6px;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>tripmate 데이터베이스 접속 상태를 확인했습니다.</p>
      </div>
      <div class="badge ${badgeClass}">${escapeHtml(badgeText)}</div>
    </header>
    <section>
      <dl>${rowsHtml}</dl>
      <div class="actions">
        <button type="button" onclick="window.location.reload()">Refresh</button>
        <span class="checked-at">Checked at ${escapeHtml(checkedAt)}</span>
      </div>
    </section>
  </main>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname !== '/' && url.pathname !== '/api/db-status') {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    const database = await checkDatabase();
    const result = {
      status: 'ok',
      database,
    };

    if (url.pathname === '/api/db-status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result, null, 2));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderStatusPage(result));
  } catch (error) {
    const result = {
      status: 'error',
      message: error.message,
    };

    if (url.pathname === '/api/db-status') {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result, null, 2));
      return;
    }

    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderStatusPage(result));
  }
});

server.listen(port, async () => {
  try {
    const database = await checkDatabase();
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Connected to MariaDB ${database.version} as ${database.currentUser}`);
  } catch (error) {
    console.error('Server started, but MariaDB connection failed.');
    console.error(error.message);
  }
});
