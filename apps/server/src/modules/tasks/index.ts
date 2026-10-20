// 1. 契约与业务服务
export { TasksService, type TaskPort, type TasksManagerPort } from './port';

// 2. HTTP 路由
export { installTaskRoutes } from './routes';

// 3. 仓储与内存存储服务
export { TaskPlanService, PlanService } from './service';

// 4. 定时调度器
export { TaskScheduler } from './scheduler';

// 5. 模型工厂与领域状态计算
export {
  emptyTaskBook,
  endedRun,
  runView,
  planDraft,
  newPlan,
  newRun,
  duePlans,
  wallClockInstant,
  nextOccurrence,
  settleTaskUsage,
  syncPlanStateFromRun,
} from './model';

// 6. 输入校验
export { validatePlan } from './validation';

// 7. 领域与 DTO 类型
export type {
  StoredRun,
  TaskBook,
  PlanQueryFilter,
  PlanControlOperation,
  RunControlOperation,
  TaskRunsPage,
} from './types';

export { TaskCoordinator } from './coordinator';
export type { TaskExecutionState, TaskHostPort } from './execution-port';
