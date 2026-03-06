const { scryptSync, randomBytes } = require("crypto");
const { Pool } = require("pg");

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const buf = scryptSync(password, salt, 64);
  return `${buf.toString("hex")}.${salt}`;
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const username = "admin";
  const password = "admin123";
  const name = "Administrator";
  const email = "admin@example.com";
  const hashedPassword = hashPassword(password);

  await pool.query(
    `
    insert into users (username, password, name, email)
    values ($1, $2, $3, $4)
    on conflict (username)
    do update set
      password = excluded.password,
      name = excluded.name,
      email = excluded.email
    `,
    [username, hashedPassword, name, email]
  );

  console.log("User admin created/updated successfully.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
