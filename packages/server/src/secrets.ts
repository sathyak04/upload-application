import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// This interface defines the structure of our secrets.
// It provides type safety so we don't misspell a secret's name.
interface AppSecrets {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
}

// Store the fetched secrets in memory.
const secrets: AppSecrets = {};
const client = new SecretManagerServiceClient();

// A list of all secret names we need to fetch.
const secretNames = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SESSION_SECRET',
];

async function accessSecretVersion(secretName: string): Promise<string | undefined> {
  try {
    const projectId = process.env.GCP_PROJECT_ID;
    if (!projectId) {
      throw new Error('GCP_PROJECT_ID environment variable not set.');
    }

    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload?.data?.toString();
    return payload;
  } catch (error) {
    console.error(`Error accessing secret ${secretName}:`, error);
    // In a real app, you might want the server to fail starting if a critical secret is missing.
    return undefined;
  }
}

export async function loadSecrets(): Promise<void> {
  console.log('Loading secrets from Google Secret Manager...');
  for (const name of secretNames) {
    const value = await accessSecretVersion(name);
    // A bit of type magic to assign the secret value to the correct key in our secrets object.
    secrets[name as keyof AppSecrets] = value;
  }
  console.log('Secrets loaded successfully.');
}

// Export the secrets object to be used elsewhere in the application.
export default secrets;