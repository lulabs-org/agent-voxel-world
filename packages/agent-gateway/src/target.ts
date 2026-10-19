import type { RpcParams } from '@voxel/gateway-protocol';

export interface GatewayTarget {
  readonly storageRevision: number;
  readonly events: {
    readonly version: number;
    publish(
      resource: 'agents' | 'providers' | 'plans' | 'runs',
      agentIds?: string[],
      detail?: { planIds?: string[]; runIds?: string[] },
    ): void;
    on(listener: (change: any) => void): () => void;
  };
  readonly plans: {
    get(id: string): { id: string; agentId?: string };
    run(id: string): { id: string; agentId?: string };
    assertRevision(id: string, expectedRevision?: number): void;
  };
  publicList(): any[];
  publicIdentity(id: string): any;
  publicPlans(id?: string, metadata?: boolean): any[];
  publicPlan(id: string): any;
  planPage(p: RpcParams): any;
  publicRuns(
    id: string | undefined,
    plan: string,
    offset?: number,
    metadata?: boolean,
  ): any;
  taskIdentity(id: string): any;
  assertWritable(id?: string): void;
  currentRunId(id: string): string | undefined;
  interrupt(id: string): void;
  settled(id: string): Promise<void>;
  flush(since?: number): Promise<void>;

  create(value: any): any;
  update(id: string, value: any): Promise<any>;
  join(id: string): any;
  stop(id: string): any;
  remove(id: string): Promise<any>;
  setVoice(id: string, value: any): Promise<any>;
  assignTask(id: string, value: any): Promise<any>;
  controlTask(id: string, op: 'pause' | 'cancel'): Promise<any>;
  resume(id: string, value: any): any;

  reassignPlan(id: string, targetAgentId: string): Promise<any>;
  createTaskPlan(agentId: string, value: any): Promise<any>;
  updateTaskPlan(
    agentId: string | undefined,
    planId: string,
    value: any,
  ): Promise<any>;
  controlTaskPlan(
    agentId: string | undefined,
    planId: string,
    operation: string,
    value: any,
  ): Promise<any>;
  controlTaskRun(
    agentId: string,
    runId: string,
    operation: string,
    value: any,
  ): Promise<any>;

  providers: {
    list(): any[];
    save(value: any, id?: string): Promise<any>;
  };
  models(providerId: string): Promise<string[]>;
  removeProvider(providerId: string): Promise<any>;

  close?(): Promise<void>;
}
