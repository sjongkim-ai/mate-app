import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from './db.js';
import authKakao from './auth-kakao.js';
import adminRouter from './admin.js';
import preferencesRouter from './preferences.js';
import matchesRouter from './matches.js';
import chatsRouter from './chats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  createDatabaseTable: true,
  charset: 'utf8mb4_unicode_ci',
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

app.use(
  session({
    name: 'mate.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-change-me',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.SESSION_COOKIE_SECURE === 'true',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.use(authKakao);
app.use(adminRouter);
app.use(preferencesRouter);
app.use(matchesRouter);
app.use(chatsRouter);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health/db', async (_req, res) => {
  try {
    const [info] = await query(
      'SELECT NOW() AS now, DATABASE() AS db, CURRENT_USER() AS user, VERSION() AS version'
    );
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(500).json({ ok: false, code: err.code, error: err.message });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).send(err.message || 'Internal Error');
});

const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
