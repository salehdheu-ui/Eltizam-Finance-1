import { runBackupRetentionJob } from "../server/backup";

runBackupRetentionJob().then((createdBackups) => {
  for (const backup of createdBackups) {
    if (backup.created) {
      console.log(`Created ${backup.frequency} backup: ${backup.filePath}`);
    }
  }
  console.log("Backup retention completed successfully.");
}).catch((error) => {
  console.error("Backup job failed:", error);
  process.exit(1);
});
