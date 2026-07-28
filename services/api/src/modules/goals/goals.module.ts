import { Module } from "@nestjs/common";
import { ExecutionsController } from "./executions.controller";
import { GoalsController } from "./goals.controller";
import { GoalsService } from "./goals.service";
import { UsageController } from "./usage.controller";

@Module({
  controllers: [GoalsController, ExecutionsController, UsageController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
