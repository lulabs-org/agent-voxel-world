import { CommandRouter } from './command-router';
import { invokeGateway } from './dispatch';
import type { GatewayTarget } from './target';
import type { RpcMethod, RpcParams } from '@voxel/gateway-protocol';

export type { GatewayTarget };

export class AgentGateway {
  readonly commands: CommandRouter;

  constructor(
    readonly target: GatewayTarget,
    commands = new CommandRouter(),
  ) {
    this.commands = commands;
  }

  get events() {
    return this.target.events;
  }

  get storageRevision() {
    return this.target.storageRevision;
  }

  get plans() {
    return this.target.plans;
  }

  get providers() {
    return this.target.providers;
  }

  assertWritable(id?: string) {
    this.target.assertWritable(id);
  }

  publicList() {
    return this.target.publicList();
  }

  publicIdentity(id: string) {
    return this.target.publicIdentity(id);
  }

  publicPlans(id?: string, metadata = false) {
    return this.target.publicPlans(id, metadata);
  }

  publicRuns(
    id: string | undefined,
    plan: string,
    offset?: number,
    metadata = false,
  ) {
    return this.target.publicRuns(id, plan, offset, metadata);
  }

  planPage(p: RpcParams) {
    return this.target.planPage(p);
  }

  publicPlan(id: string) {
    return this.target.publicPlan(id);
  }

  taskIdentity(id: string) {
    return this.target.taskIdentity(id);
  }

  currentRunId(id: string) {
    return this.target.currentRunId(id);
  }

  interrupt(id: string) {
    this.target.interrupt(id);
  }

  async settled(id: string) {
    await this.target.settled(id);
  }

  async flush(since?: number) {
    await this.target.flush(since);
  }

  create(value: any) {
    return this.target.create(value);
  }

  async update(id: string, value: any) {
    return this.target.update(id, value);
  }

  join(id: string) {
    return this.target.join(id);
  }

  stop(id: string) {
    return this.target.stop(id);
  }

  async remove(id: string) {
    return this.target.remove(id);
  }

  async setVoice(id: string, value: any) {
    return this.target.setVoice(id, value);
  }

  async assignTask(id: string, value: any) {
    return this.target.assignTask(id, value);
  }

  async controlTask(id: string, op: 'pause' | 'cancel') {
    return this.target.controlTask(id, op);
  }

  resume(id: string, value: any) {
    return this.target.resume(id, value);
  }

  async reassignPlan(id: string, targetAgentId: string) {
    return this.target.reassignPlan(id, targetAgentId);
  }

  async createTaskPlan(agentId: string, value: any) {
    return this.target.createTaskPlan(agentId, value);
  }

  async updateTaskPlan(
    agentId: string | undefined,
    planId: string,
    value: any,
  ) {
    return this.target.updateTaskPlan(agentId, planId, value);
  }

  async controlTaskPlan(
    agentId: string | undefined,
    planId: string,
    operation: string,
    value: any,
  ) {
    return this.target.controlTaskPlan(agentId, planId, operation, value);
  }

  async controlTaskRun(
    agentId: string | undefined,
    runId: string,
    operation: string,
    value: any,
  ) {
    return this.target.controlTaskRun(agentId, runId, operation, value);
  }

  async models(providerId: string) {
    return this.target.models(providerId);
  }

  async removeProvider(providerId: string) {
    return this.target.removeProvider(providerId);
  }

  async close() {
    await this.target.close?.();
  }

  async dispatch(
    method: RpcMethod,
    params: RpcParams,
    commandId?: string,
    legacy = false,
  ) {
    return invokeGateway(this, method, params, commandId, legacy);
  }
}
