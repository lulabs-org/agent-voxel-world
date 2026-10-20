import type { TaskPort } from '../tasks/port';

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
  readonly tasks: TaskPort;
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

  providers: {
    list(): any[];
    save(value: any, id?: string): Promise<any>;
  };
  models(providerId: string): Promise<string[]>;
  removeProvider(providerId: string): Promise<any>;

  close?(): Promise<void>;
}
