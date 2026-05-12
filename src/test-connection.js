import { pool, query } from './db.js';

try {
  const [{ now, db, user }] = await query(
    'SELECT NOW() AS now, DATABASE() AS db, CURRENT_USER() AS user'
  );
  console.log('Connected.');
  console.log('  user :', user);
  console.log('  db   :', db);
  console.log('  now  :', now);
} catch (err) {
  console.error('Connection failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
