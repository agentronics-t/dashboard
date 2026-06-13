// Secret Manager read access (worker only reads — the API writes).

export interface SecretReader {
  read(name: string): Promise<string>;
}

export class GcpSecretReader implements SecretReader {
  private clientPromise:
    | Promise<
        InstanceType<
          typeof import("@google-cloud/secret-manager").SecretManagerServiceClient
        >
      >
    | undefined;
  private readonly project: string;

  constructor(project: string) {
    this.project = project;
  }

  private client() {
    this.clientPromise ??= import("@google-cloud/secret-manager").then(
      ({ SecretManagerServiceClient }) => new SecretManagerServiceClient()
    );
    return this.clientPromise;
  }

  async read(name: string): Promise<string> {
    const client = await this.client();
    const [version] = await client.accessSecretVersion({
      name: `projects/${this.project}/secrets/${name}/versions/latest`
    });
    const data = version.payload?.data;
    if (!data) throw new Error(`secret ${name} has no payload`);
    return Buffer.from(data).toString("utf8");
  }
}
