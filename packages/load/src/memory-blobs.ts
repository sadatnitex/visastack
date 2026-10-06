import type {
  BlobStore,
  ListObjectKeysInput,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from '@visastack/services';

/** A file store held in memory: stands in for private blob storage so file speed is not part of the database numbers. */
export class MemoryBlobStore implements BlobStore {
  private readonly objects = new Map<string, PutObjectInput>();

  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, input);
  }

  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    const found = this.objects.get(objectKey);
    return found ? { contentType: found.contentType, bytes: found.bytes } : undefined;
  }

  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }

  async listObjectKeys(input: ListObjectKeysInput): Promise<ListObjectsPage> {
    const objectKeys = [...this.objects.values()]
      .filter((o) => o.bucket === input.bucket)
      .map((o) => o.objectKey);
    return { objectKeys, cursor: undefined };
  }
}
