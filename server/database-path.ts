import path from "path";

export const databasePath = path.resolve(process.env.DATABASE_PATH || "./eltizam.db");
export const backupRootPath = path.resolve(process.env.BACKUP_ROOT_PATH || "./backups/eltizam-db");
