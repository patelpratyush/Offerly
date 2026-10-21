import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { createStore as createLocalStore } from "../../server/store.js";

// Every PostgreSQL fixture owns a random schema. Never truncate shared tables.
export async function createStore(path) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || path !== ":memory:") return createLocalStore(path);
  const schema = `test_${randomBytes(12).toString("hex")}`;
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(new URL(file, directory), "utf8");
    await pool.query(sql.replaceAll("offerly", schema));
  }
  const store = await createLocalStore(url, { pool, schema });
  store.db.close = async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  };
  return store;
}
