// server/src/protocol.ts and web/src/protocol.ts must stay byte-identical —
// they are the two halves of the WS wire contract. This runs as part of
// `npm run typecheck` so drift fails CI/dev instead of landing silently.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server = path.join(root, 'server', 'src', 'protocol.ts');
const web = path.join(root, 'web', 'src', 'protocol.ts');

if (readFileSync(server, 'utf8') !== readFileSync(web, 'utf8')) {
  console.error(
    'protocol drift: server/src/protocol.ts and web/src/protocol.ts differ.\n' +
      'They must be byte-identical — copy the edited one over the other.',
  );
  process.exit(1);
}
console.log('[check-protocol] protocol.ts files are in sync');
