// Triggers the intel-ml Cloud Run Job after a successful import.
// Fire-and-forget: we start the execution but do not wait for completion.

import type { Env } from "./env.ts";

export interface MlTrigger {
  /** traceparent joins the ML execution to the API→worker trace (TRACEPARENT env). */
  trigger(jobId: string, traceparent?: string): Promise<void>;
}

export class GcpMlTrigger implements MlTrigger {
  private clientPromise:
    | Promise<InstanceType<typeof import("@google-cloud/run").JobsClient>>
    | undefined;
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  private client() {
    this.clientPromise ??= import("@google-cloud/run").then(
      ({ JobsClient }) => new JobsClient()
    );
    return this.clientPromise;
  }

  async trigger(jobId: string, traceparent?: string): Promise<void> {
    const client = await this.client();
    await client.runJob({
      name: `projects/${this.env.GCP_PROJECT}/locations/${this.env.GCP_REGION}/jobs/${this.env.ML_JOB_NAME}`,
      overrides: {
        containerOverrides: [
          {
            args: ["--job-id", jobId],
            env: traceparent ? [{ name: "TRACEPARENT", value: traceparent }] : []
          }
        ]
      }
    });
  }
}
