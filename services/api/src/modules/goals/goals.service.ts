import { Inject, Injectable } from "@nestjs/common";
import type {
  CursorPageQuery,
  ExecutionId,
  GoalId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import { ConflictError, NotFoundError, newId } from "@repo/core";
import type {
  Execution,
  ExecutionRepository,
  Goal,
  GoalRepository,
  Task,
  TaskQueue,
  TaskRepository,
} from "@repo/runtime";
import {
  ApprovalGate,
  canRequestCancellation,
  newExecutionFor,
} from "@repo/runtime";
import type { DrizzleAiUsageRepository } from "@repo/database";
import {
  AI_USAGE_REPOSITORY,
  EXECUTION_REPOSITORY,
  GOAL_REPOSITORY,
  TASK_REPOSITORY,
} from "../../infra/database/database.module";
import { TASK_QUEUE } from "../../infra/redis/redis.module";
import { requestContext } from "../../common/context/request-context";
import { parseRouteId } from "../../common/parse-id";
import type { ApprovalBody, CreateGoalBody } from "./goals.dto";

@Injectable()
export class GoalsService {
  constructor(
    @Inject(GOAL_REPOSITORY) private readonly goals: GoalRepository,
    @Inject(EXECUTION_REPOSITORY)
    private readonly executions: ExecutionRepository,
    @Inject(TASK_REPOSITORY) private readonly tasks: TaskRepository,
    @Inject(AI_USAGE_REPOSITORY)
    private readonly aiUsage: DrizzleAiUsageRepository,
    @Inject(TASK_QUEUE) queue: TaskQueue,
  ) {
    this.approvals = new ApprovalGate({
      executions: this.executions,
      tasks: this.tasks,
      queue,
    });
  }

  private readonly approvals: ApprovalGate;

  async createGoal(
    workspaceId: WorkspaceId,
    ownerId: UserId,
    body: CreateGoalBody,
  ): Promise<Goal> {
    return this.goals.create({
      workspaceId,
      ownerId,
      title: body.title,
      objective: body.objective,
      description: body.description ?? null,
      type: body.type,
      priority: body.priority,
      constraints: body.constraints,
      inputs: body.inputs,
      outputs: body.outputs,
      schedule: body.schedule ?? null,
    });
  }

  async getGoal(id: GoalId, userId: UserId): Promise<Goal> {
    const goal = await this.goals.findByIdForUser(id, userId);
    if (!goal) throw new NotFoundError("Goal not found.", "GOAL_NOT_FOUND");
    return goal;
  }

  /**
   * Stop a Goal from running again.
   *
   * The gap this fills: a recurring Goal could be created and never turned
   * off. Someone who set up "post every morning at 8" had no way to stop it
   * short of editing the database by hand — and the verification script that
   * creates a Goal firing every minute left one running on every machine it
   * touched.
   */
  async archiveGoal(id: GoalId, userId: UserId): Promise<Goal> {
    const archived = await this.goals.archive(id, userId);
    if (!archived) {
      // 404 rather than 403, like every other read here: whether a Goal exists
      // in another tenant is not this caller's business.
      throw new NotFoundError("Goal not found.", "GOAL_NOT_FOUND");
    }
    return archived;
  }

  async listGoals(
    workspaceId: WorkspaceId,
    userId: UserId,
    query: CursorPageQuery,
  ) {
    return this.goals.listForUser(workspaceId, userId, query);
  }

  /**
   * Submit a Goal for execution.
   *
   * This only writes a CREATED row — planning happens in the runtime process.
   * From Phase 2 planning involves an LLM call, and an HTTP request must not
   * block on that; keeping the boundary asynchronous now avoids reworking it.
   */
  async submit(goalId: string, userId: UserId): Promise<Execution> {
    const goal = await this.getGoal(parseRouteId("goal", goalId), userId);

    const correlationId = requestContext.correlationId();
    const execution = newExecutionFor(
      goal,
      correlationId === "unknown" ? newId("request") : correlationId,
    );

    return this.executions.create(execution);
  }

  async getExecution(id: ExecutionId, userId: UserId): Promise<Execution> {
    const execution = await this.executions.findByIdForUser(id, userId);
    if (!execution) {
      throw new NotFoundError("Execution not found.", "EXECUTION_NOT_FOUND");
    }
    return execution;
  }

  async listExecutions(
    workspaceId: WorkspaceId,
    userId: UserId,
    query: CursorPageQuery,
  ) {
    return this.executions.listForUser(workspaceId, userId, query);
  }

  async listTasks(
    executionId: ExecutionId,
    userId: UserId,
  ): Promise<readonly Task[]> {
    // Reuse the membership-scoped read so a foreign execution's tasks are
    // unreachable rather than merely forbidden.
    await this.getExecution(executionId, userId);
    return this.tasks.listByExecution(executionId);
  }

  /**
   * What one execution cost in AI provider calls.
   *
   * Goes through getExecution first so a foreign execution's spend is
   * unreachable rather than merely forbidden — the same rule as its tasks.
   */
  async listUsage(executionId: ExecutionId, userId: UserId) {
    await this.getExecution(executionId, userId);
    const calls = await this.aiUsage.listByExecution(executionId);

    return {
      calls,
      // Summed from the exact decimal strings, not from floats, and reported
      // as a string for the same reason: this is money.
      totalUsd: calls
        .reduce((sum, call) => sum + Number(call.costUsd), 0)
        .toFixed(8),
      totalTokens: calls.reduce((sum, call) => sum + call.totalTokens, 0),
      /** Calls whose model had no price, so totalUsd is short by their cost. */
      unpricedCalls: calls.filter((call) => !call.costPriced).length,
    };
  }

  /**
   * Record a person's approval decision on a waiting Execution.
   *
   * Membership-scoped through getExecution first, so someone outside the
   * workspace cannot approve a post to it — the whole point of the gate.
   */
  async decideApproval(
    id: ExecutionId,
    userId: UserId,
    body: ApprovalBody,
  ): Promise<Execution> {
    const execution = await this.getExecution(id, userId);

    if (execution.status !== "WAITING") {
      throw new ConflictError(
        `This execution is ${execution.status}, so there is nothing awaiting approval.`,
        "NOT_AWAITING_APPROVAL",
      );
    }

    await this.approvals.decide({
      executionId: id,
      decision: body.decision,
      actorId: userId,
      ...(body.note === undefined ? {} : { note: body.note }),
    });

    return this.getExecution(id, userId);
  }

  /**
   * Request cancellation. The Execution enters CANCELLING and only reaches
   * CANCELLED once the runtime has unwound in-flight work — a hard stop would
   * strand a running worker (docs/kernel/04_STATE_MACHINE.md).
   */
  async cancel(id: ExecutionId, userId: UserId): Promise<Execution> {
    const execution = await this.getExecution(id, userId);

    if (!canRequestCancellation(execution.status)) {
      throw new ConflictError(
        `An execution in status ${execution.status} cannot be cancelled.`,
        "EXECUTION_NOT_CANCELLABLE",
      );
    }

    const cancelling = await this.executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version,
      expectedStatus: execution.status,
      status: "CANCELLING",
    });

    if (!cancelling) {
      // The runtime moved it on between our read and write.
      throw new ConflictError(
        "This execution changed while the request was in flight. Reload and try again.",
        "VERSION_CONFLICT",
      );
    }

    return cancelling;
  }
}
