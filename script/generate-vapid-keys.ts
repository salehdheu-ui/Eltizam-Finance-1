import webpush from "web-push";

/**
 * Prints a fresh VAPID key pair for the push notification service.
 *
 * Generate once per deployment and keep the pair stable. Replacing it
 * invalidates every subscription already stored, and those devices go quiet
 * without any error — the browser keeps pushing to an endpoint the new key can
 * no longer authorise, so users would have to turn notifications off and on
 * again to recover.
 */
const keys = webpush.generateVAPIDKeys();

console.log("Add these to your environment, then restart the server:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:admin@example.com`);
console.log("\nKeep VAPID_PRIVATE_KEY secret, and keep the pair stable across deploys.");
