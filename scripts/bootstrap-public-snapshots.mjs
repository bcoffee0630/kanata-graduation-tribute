import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { assertTransactionOwner, DeliveryOperatorError, initializeOperator, ownerSession,
  parseOperatorOptions, PRODUCTION, reportOperatorError, requireFunctions } from './public-delivery-operator.mjs';

const HELP = `Run one bounded private public-snapshot producer cycle. Default: read-only plan.
  --project <kanata-memorial|kanata-memorial-admin|demo-kanata-governance>
  --bucket <dedicated-private-snapshot-bucket>
  --writer-service-account <deployed-worker-runtime-identity> (remote apply required)
Apply: --apply --owner-uid <existing-owner> --reason <reason>
Production additionally requires maintenance enabled and:
  --confirm-production kanata-memorial --release-tag <annotated-HEAD-tag>
An existing Owner Password-session token is read only from hidden TTY/stdin.
Uses the same revision claims, two-second coalescing and bounded queries as the worker.
If content changes during publication, retry after the private follow-up task settles.
`;

export async function main(args = process.argv.slice(2)) {
  const options = parseOperatorOptions(args, { '--writer-service-account': 'writerServiceAccount' });
  if (options.help) { console.log(HELP); return; }
  if (options.apply && options.project !== 'demo-kanata-governance'
    && !/^[a-z0-9-]+@(?:[a-z0-9-]+\.iam\.gserviceaccount\.com|developer\.gserviceaccount\.com)$/.test(options.writerServiceAccount || '')) {
    throw new DeliveryOperatorError('Remote bootstrap apply requires --writer-service-account matching the deployed worker.');
  }
  const operator = initializeOperator(options);
  const { deleteApp } = requireFunctions('firebase-admin/app');
  const { runPublicSnapshotPublisher } = await import('../functions/lib/public-snapshots.js');
  const { publicSnapshotBucket } = await import('../functions/lib/public-snapshot-storage.js');
  const { auditData } = await import('../functions/lib/core.js');
  const { parsePublicSnapshotPointer } = await import('../functions/lib/public-snapshot-core.js');
  const pointerFile = publicSnapshotBucket().file('public-snapshots/current.json');
  const readPointer = async () => {
    try {
      const [bytes] = await pointerFile.download();
      if (bytes.length > 16_384) throw new DeliveryOperatorError('Snapshot pointer is too large.');
      const pointer = parsePublicSnapshotPointer(JSON.parse(bytes.toString('utf8')));
      if (!pointer) throw new DeliveryOperatorError('Snapshot pointer schema is invalid.');
      return { ...pointer, validNow: pointer.validUntil > Date.now() };
    } catch (error) {
      if (Number(error?.code) === 404) return null;
      throw error;
    }
  };
  try {
    const pointer = await readPointer();
    if (!options.apply) {
      console.log(JSON.stringify({ mode: 'dry-run', projectId: options.project, pointer,
        intendedAction: 'Run the private producer with persisted revision claims and bounded source reads.' }, null, 2));
      return;
    }
    if (options.project !== 'demo-kanata-governance') {
      const access = await operator.credential.getAccessToken();
      const response = await fetch(`https://cloudfunctions.googleapis.com/v2/projects/${options.project}/locations/asia-east1/functions/publishPublicSnapshots`, {
        headers: { Authorization: `Bearer ${access.access_token}`, 'X-Goog-User-Project': options.project },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new DeliveryOperatorError('Cannot verify the deployed private worker before bootstrap.');
      const worker = await response.json();
      if (worker.state !== 'ACTIVE' || worker.serviceConfig?.serviceAccountEmail !== options.writerServiceAccount
        || worker.serviceConfig?.environmentVariables?.PUBLIC_SNAPSHOT_BUCKET !== options.bucket) {
        throw new DeliveryOperatorError('Bootstrap writer identity/bucket does not match the active deployed worker.');
      }
    }
    await ownerSession(operator, options, async (actor) => {
      await operator.db.runTransaction(async (transaction) => {
        const reads = [transaction.get(operator.db.collection('adminAccounts').doc(actor.uid))];
        if (options.project === PRODUCTION) reads.push(transaction.get(operator.db.doc('system/maintenance')));
        const [owner, maintenance] = await Promise.all(reads);
        assertTransactionOwner(owner, actor);
        if (options.project === PRODUCTION && maintenance.data()?.enabled !== true) {
          throw new DeliveryOperatorError('Production bootstrap requires the maintenance lock.');
        }
        transaction.create(operator.db.collection('adminAuditLogs').doc(), auditData(actor,
          'public_delivery.snapshot_bootstrap_requested', 'system', 'publicSnapshots', options.reason,
          { requestedAt: Date.now(), releaseTag: options.releaseTag || '' }));
      });
      const result = await runPublicSnapshotPublisher();
      const publishedPointer = await readPointer();
      await operator.db.collection('adminAuditLogs').add(auditData(actor,
        'public_delivery.snapshot_bootstrap_result', 'system', 'publicSnapshots', options.reason,
        { result, pointer: publishedPointer, releaseTag: options.releaseTag || '' }));
      if (!['published', 'duplicate'].includes(result) || !publishedPointer?.validNow) {
        throw new DeliveryOperatorError(`Snapshot bootstrap result: ${result}; no live valid snapshot is ready. Allow pending private tasks to settle, inspect worker errors, then retry.`);
      }
      console.log(JSON.stringify({ mode: 'apply', projectId: options.project, result, pointer: publishedPointer }, null, 2));
    });
  } finally { await operator.db.terminate(); await deleteApp(operator.app); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(reportOperatorError);
