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

  get tasks() {
    return this.target.tasks;
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

  async models(providerId: string) {
    return this.target.models(providerId);
  }

  async removeProvider(providerId: string) {
    return this.target.removeProvider(providerId);
  }

  async close() {
    await this.target.close?.();
  }

  async dispatch(method: RpcMethod, params: RpcParams, commandId?: string) {
    return invokeGateway(this, method, params, commandId);
  }
}
