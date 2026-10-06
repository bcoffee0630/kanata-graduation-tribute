import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { assertTransactionOwner, DeliveryOperatorError, initializeOperator, ownerSession,
  parseOperatorOptions, PRODUCTION, reportOperatorError, requireFunctions } from './public-delivery-operator.mjs';

const HELP = `Bounded X gallery sample-key backfill. Default: read-only dry-run.
  --project <kanata-memorial|kanata-memorial-admin|demo-kanata-governance>
  --bucket <dedicated-private-snapshot-bucket>
  [--page-size 100] [--max-documents 1000] [--after-id <last-scanned-document-id>]
Apply: --apply --owner-uid <existing-owner> --reason <reason>
Production also requires maintenance enabled and:
  --confirm-production kanata-memorial --release-tag <annotated-HEAD-tag>
Resume with the returned afterId. Maximum page size 100; maximum scan 10,000.
Only missing/invalid sample keys on X documents are updated. No content is restored.
`;

export async function main(args = process.argv.slice(2)) {
  const options = parseOperatorOptions(args, { '--page-size': 'pageSize', '--max-documents': 'maxDocuments',
    '--after-id': 'afterId' });
  if (options.help) { console.log(HELP); return; }
  const pageSize = Number(options.pageSize || 100);
  const maxDocuments = Number(options.maxDocuments || 1000);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
    || !Number.isSafeInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 10_000
    || (options.afterId && !/^[^/\s]{1,1500}$/.test(options.afterId))) {
    throw new DeliveryOperatorError('Invalid scan bounds or --after-id.');
  }
  const operator = initializeOperator(options);
  const { deleteApp } = requireFunctions('firebase-admin/app');
  const { FieldPath, FieldValue } = requireFunctions('firebase-admin/firestore');
  const { xFanartSampleKey } = await import('../functions/lib/fanart-link.js');
  const { auditData } = await import('../functions/lib/core.js');
  const validKey = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1;
  let scanned = 0; let candidates = 0; let updated = 0; let afterId = options.afterId || '';
  const run = async (actor) => {
    let finished = false;
    while (scanned < maxDocuments) {
      let query = operator.db.collection('fanart').orderBy(FieldPath.documentId()).limit(Math.min(pageSize, maxDocuments - scanned));
      if (afterId) query = query.startAfter(afterId);
      const page = await query.get();
      if (page.empty) { finished = true; break; }
      const needsKey = page.docs.filter((doc) => {
        const data = doc.data();
        return data.sourceType === 'x' && /^\d{1,25}$/.test(data.postId || '') && !validKey(data.sampleKey);
      });
      candidates += needsKey.length;
      if (options.apply && needsKey.length) {
        updated += await operator.db.runTransaction(async (transaction) => {
          const reads = [transaction.get(operator.db.collection('adminAccounts').doc(actor.uid)),
            ...needsKey.map((doc) => transaction.get(doc.ref))];
          if (options.project === PRODUCTION) reads.push(transaction.get(operator.db.doc('system/maintenance')));
          const [account, ...documents] = await Promise.all(reads);
          assertTransactionOwner(account, actor);
          if (options.project === PRODUCTION && documents.at(-1).data()?.enabled !== true) {
            throw new DeliveryOperatorError('Production backfill requires the maintenance lock.');
          }
          let count = 0;
          for (const doc of documents.slice(0, needsKey.length)) {
            const data = doc.data();
            if (!doc.exists || data.sourceType !== 'x' || !/^\d{1,25}$/.test(data.postId || '') || validKey(data.sampleKey)) continue;
            transaction.update(doc.ref, { sampleKey: xFanartSampleKey(data.postId) }); count += 1;
          }
          if (count) {
            transaction.set(operator.db.doc('system/publicContentRevision'), {
              fanartRevision: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            transaction.create(operator.db.collection('adminAuditLogs').doc(), auditData(actor,
              'public_delivery.sample_key_backfill', 'fanart', 'bounded-page', options.reason,
              { count, firstId: page.docs[0].id, afterId: page.docs.at(-1).id, releaseTag: options.releaseTag || '' }));
          }
          return count;
        });
      }
      scanned += page.size; afterId = page.docs.at(-1).id;
      if (page.size < Math.min(pageSize, maxDocuments - scanned + page.size)) { finished = true; break; }
    }
    console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', projectId: options.project,
      scanned, candidates, updated, afterId, finished,
      continueWith: finished ? null : `--after-id ${afterId} --max-documents ${maxDocuments}` }, null, 2));
  };
  try { if (options.apply) await ownerSession(operator, options, run); else await run(null); }
  finally { await operator.db.terminate(); await deleteApp(operator.app); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(reportOperatorError);
