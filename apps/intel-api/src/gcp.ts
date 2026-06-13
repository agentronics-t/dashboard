// Cloud Tasks + Secret Manager behind interfaces (mocked in tests).
// GCP clients are lazy-imported so unit tests never touch GCP SDKs.

import type { Env } from "./env.ts";

export interface TaskQueue {
  /**
   * Enqueue an import job. Payload is job_id (+ optional W3C traceparent so the
   * worker joins the same trace) — the worker loads everything else itself.
   */
  enqueueImport(jobId: string, traceparent?: string): Promise<void>;
}

export interface SecretStore {
  /** Create/update a secret value; returns the Secret Manager secret name (the ref). */
  write(name: string, value: string): Promise<string>;
}

export class GcpTaskQueue implements TaskQueue {
  private clientPromise:
    | Promise<InstanceType<typeof import("@google-cloud/tasks").CloudTasksClient>>
    | undefined;
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  private client() {
    this.clientPromise ??= import("@google-cloud/tasks").then(
      ({ CloudTasksClient }) => new CloudTasksClient()
    );
    return this.clientPromise;
  }

  async enqueueImport(jobId: string, traceparent?: string): Promise<void> {
    const client = await this.client();
    const parent = client.queuePath(
      this.env.GCP_PROJECT,
      this.env.GCP_REGION,
      this.env.TASKS_QUEUE
    );
    const payload = { job_id: jobId, ...(traceparent ? { traceparent } : {}) };
    await client.createTask({
      parent,
      task: {
        httpRequest: {
          url: `${this.env.WORKER_URL}/tasks/import`,
          httpMethod: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(traceparent ? { traceparent } : {})
          },
          body: Buffer.from(JSON.stringify(payload)).toString("base64"),
          oidcToken: { serviceAccountEmail: this.env.TASKS_OIDC_SERVICE_ACCOUNT }
        }
      }
    });
  }
}

export class GcpSecretStore implements SecretStore {
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

  async write(name: string, value: string): Promise<string> {
    const client = await this.client();
    const parent = `projects/${this.project}`;
    try {
      await client.createSecret({
        parent,
        secretId: name,
        secret: { replication: { automatic: {} } }
      });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code !== 6 /* ALREADY_EXISTS */) throw err;
    }
    await client.addSecretVersion({
      parent: `${parent}/secrets/${name}`,
      payload: { data: Buffer.from(value, "utf8") }
    });
    return name;
  }
}
