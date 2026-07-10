import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'kanata-memorial';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] || '') : '';
}

const project = argument('--project');
const confirmation = argument('--confirm-production');
const state = argument('--state');
const stateConfirmation = argument('--confirm-maintenance-state');

if (
  project !== PROJECT ||
  confirmation !== PROJECT ||
  !['enabled', 'disabled'].includes(state) ||
  stateConfirmation !== state
) {
  console.error(
    'Refusing maintenance state change. Production project and requested state must be confirmed.'
  );
  process.exit(1);
}

const credential = applicationDefault();
initializeApp({ projectId: PROJECT, credential });
const db = getFirestore();
const maintenanceRef = db.collection('system').doc('maintenance');
const enabled = state === 'enabled';

await maintenanceRef.set({
  enabled,
  reason: enabled ? 'governance-production-migration' : '',
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: 'production-deployment'
}, { merge: true });

const verified = await maintenanceRef.get();
if (!verified.exists || verified.data()?.enabled !== enabled) {
  throw new Error('Unable to verify the production maintenance state.');
}

console.log(JSON.stringify({ projectId: PROJECT, maintenanceEnabled: enabled }, null, 2));
