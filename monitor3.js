const { Pool } = require("pg");
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_C1wINqPdF6vi@ep-shy-lab-anjni111.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require"
});
(async () => {
  const r = await pool.query('SELECT COUNT(*) as c FROM "P2PCapacity"');
  console.log("Before change:", r.rows[0].c, "records");

  // Instead of rename (which triggers cascade issues), let's just change a field
  await pool.query('UPDATE "P2PCapacity" SET provider = provider || \'_modified\'');
  console.log("Modified provider field");

  const r2 = await pool.query('SELECT id, provider, "createdAt"::text FROM "P2PCapacity" ORDER BY id');
  console.log("After update:", r2.rows.length, "records");
  r2.rows.forEach(row => console.log("  ", row.id, row.provider, "createdAt:", row.createdAt));

  // Wait 15 seconds and check if records were replaced
  await new Promise(r => setTimeout(r, 15000));

  const r3 = await pool.query('SELECT COUNT(*) as c FROM "P2PCapacity"');
  console.log("After 15s:", r3.rows[0].c, "records");
  if (Number(r3.rows[0].c) > 0) {
    const r4 = await pool.query('SELECT id, provider, "createdAt"::text FROM "P2PCapacity" ORDER BY id');
    r4.rows.forEach(row => console.log("  ", row.id, row.provider, "createdAt:", row.createdAt));
  }
  pool.end();
})().catch(e => { console.error(e.message); pool.end(); });
