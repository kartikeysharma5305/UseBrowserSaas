import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

import {
  artifactStorageHealth,
  getArtifactStorageConfiguration,
} from '../src/lib/browser/artifact-storage-config';

const configuration = getArtifactStorageConfiguration();
if (configuration.driver === 'LOCAL') {
  console.log(JSON.stringify(artifactStorageHealth()));
  process.exit(0);
}

const s3 = configuration.s3!;
const client = new S3Client({
  region: s3.region,
  ...(s3.endpoint ? { endpoint: s3.endpoint } : {}),
  forcePathStyle: s3.forcePathStyle,
  credentials: {
    accessKeyId: s3.accessKeyId,
    secretAccessKey: s3.secretAccessKey,
  },
});
await client.send(new HeadBucketCommand({ Bucket: s3.bucket }));
console.log(JSON.stringify(artifactStorageHealth()));
