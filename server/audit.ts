import path from "path";
import { appendFile, mkdir } from "fs/promises";

const auditDirectoryPath = path.resolve("./logs");
const auditLogFilePath = path.join(auditDirectoryPath, "audit.log");

export type AuditEventInput = {
  action: string;
  actorUserId?: number | null;
  actorRole?: string | null;
  targetUserId?: number | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAuditEvent(event: AuditEventInput) {
  await mkdir(auditDirectoryPath, { recursive: true });

  const payload = {
    timestamp: new Date().toISOString(),
    action: event.action,
    actorUserId: event.actorUserId ?? null,
    actorRole: event.actorRole ?? null,
    targetUserId: event.targetUserId ?? null,
    ipAddress: event.ipAddress ?? null,
    metadata: event.metadata ?? {},
  };

  await appendFile(auditLogFilePath, `${JSON.stringify(payload)}\n`, "utf8");
}
