// Read-only preflight before staging changes raw-data Rules or releases the UI.
import { applicationDefault } from 'firebase-admin/app';
import { verifyPublicSnapshotInfrastructure } from './verify-public-snapshot-infrastructure.mjs';
const project = 'kanata-memorial-admin';
const token = await applicationDefault().getAccessToken();
const api = async (url, options = {}) => {
  const response = await fetch(url, { ...options,
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', 'X-Goog-User-Project': project },
    signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Staging snapshot verification request failed (${response.status}); no release was performed.`);
  return response.json();
};
const response = await api(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/asia-east1/functions?pageSize=100`);
if (response.nextPageToken) throw new Error('Staging Functions inventory is truncated; no release was performed.');
const result = await verifyPublicSnapshotInfrastructure({ project, inventory: response.functions || [], api });
console.log(JSON.stringify({ projectId: project, ...result }, null, 2));
