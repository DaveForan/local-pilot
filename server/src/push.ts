import fs from 'node:fs/promises';
import webpush from 'web-push';
import { paths } from './config';

// Web-push notifications. local-pilot generates its own VAPID keypair on
// first run and keeps the set of browser subscriptions on disk, so push
// survives a server restart. Notifications require the UI to be served over
// HTTPS (or localhost) — see the README.

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** A browser PushSubscription, as serialised by `subscription.toJSON()`. */
export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Session the notification refers to — used to deep-link on click. */
  sessionId: string;
  /** Collapses repeat notifications for the same session. */
  tag?: string;
}

// VAPID requires a contact subject; override with PUSH_SUBJECT if desired.
const SUBJECT = process.env.PUSH_SUBJECT ?? 'mailto:local-pilot@localhost';

let vapid: VapidKeys | null = null;
let subscriptions: PushSubscriptionRecord[] = [];

async function loadOrCreateVapid(): Promise<VapidKeys> {
  try {
    return JSON.parse(await fs.readFile(paths.vapid, 'utf8')) as VapidKeys;
  } catch {
    const keys = webpush.generateVAPIDKeys();
    await fs.writeFile(paths.vapid, JSON.stringify(keys, null, 2) + '\n', 'utf8');
    console.log('[push] generated a new VAPID keypair');
    return keys;
  }
}

async function loadSubscriptions(): Promise<PushSubscriptionRecord[]> {
  try {
    return JSON.parse(await fs.readFile(paths.pushSubs, 'utf8')) as PushSubscriptionRecord[];
  } catch {
    return [];
  }
}

// Serialize file writes: add/remove/prune can overlap (e.g. two turns
// finishing at once), and interleaved writeFile calls corrupt the JSON.
// Each queued write snapshots the *current* array when it runs, so the last
// write in the chain always lands the latest state.
let writeChain: Promise<void> = Promise.resolve();

function saveSubscriptions(): Promise<void> {
  writeChain = writeChain
    .then(() =>
      fs.writeFile(paths.pushSubs, JSON.stringify(subscriptions, null, 2) + '\n', 'utf8'),
    )
    .catch((err) => console.error('[push] failed to save subscriptions:', err));
  return writeChain;
}

/** Load keys + subscriptions; call once at startup. */
export async function initPush(): Promise<void> {
  vapid = await loadOrCreateVapid();
  webpush.setVapidDetails(SUBJECT, vapid.publicKey, vapid.privateKey);
  subscriptions = await loadSubscriptions();
  console.log(`[push] ready — ${subscriptions.length} subscription(s)`);
}

/** The VAPID public key the browser needs to create a subscription. */
export function vapidPublicKey(): string {
  return vapid?.publicKey ?? '';
}

export async function addSubscription(sub: PushSubscriptionRecord): Promise<void> {
  if (!sub || typeof sub.endpoint !== 'string') {
    throw new Error('Invalid push subscription');
  }
  if (!subscriptions.some((s) => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
    await saveSubscriptions();
  }
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const before = subscriptions.length;
  subscriptions = subscriptions.filter((s) => s.endpoint !== endpoint);
  if (subscriptions.length !== before) await saveSubscriptions();
}

/** Fan a notification out to every subscription, pruning expired ones. */
export async function sendPush(payload: PushPayload): Promise<void> {
  if (!vapid || subscriptions.length === 0) return;
  const data = JSON.stringify(payload);
  const dead: string[] = [];
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, data);
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // 404/410 — the subscription is gone; drop it.
        if (code === 404 || code === 410) dead.push(sub.endpoint);
        else console.error('[push] send failed:', code ?? err);
      }
    }),
  );
  if (dead.length) {
    subscriptions = subscriptions.filter((s) => !dead.includes(s.endpoint));
    await saveSubscriptions();
  }
}
