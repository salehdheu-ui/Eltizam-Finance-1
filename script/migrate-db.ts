import { getCurrentDatabaseSchemaVersion, migrateDatabase } from "../server/db";

migrateDatabase().then((result) => {
  if (result.appliedCount > 0) {
    console.log(`Database migrated successfully to schema v${result.targetVersion}. Applied ${result.appliedCount} migration step${result.appliedCount === 1 ? "" : "s"}.${result.backupCreated ? " Backup created." : ""}`);
  } else {
    return getCurrentDatabaseSchemaVersion().then((version) => {
      console.log(`Database is already up to date at schema v${version}.`);
    });
  }
}).catch((error) => {
  console.error("Database migration failed:", error);
  process.exit(1);
});
