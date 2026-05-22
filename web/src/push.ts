// Browser-side push notification setup: registers the service worker,
// subscribes to web-push, and reports the subscription to the server.

import { api } from './api';

const SW_URL = '/sw.js';

export type PushStatus =
  | 'unsupported' // browser lacks service workers / push
  | 'denied' // user has blocked notifications
  | 'off' // supported, not subscribed
  | 'on'; // subscribed on this device

function supported(): boolean {
  return (
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  );
}

/** VAPID public keys arrive base64url-encoded; the API wants a byte array. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function pushStatus(): Promise<PushStatus> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

export async function enablePush(): Promise<PushStatus> {
  if (!supported()) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const { publicKey } = await api.pushVapid();
  if (!publicKey) throw new Error('Server has no VAPID key configured.');

  const reg = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await api.pushSubscribe(sub.toJSON());
  return 'on';
}

export async function disablePush(): Promise<PushStatus> {
  if (!supported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint);
    await sub.unsubscribe();
  }
  return 'off';
}
