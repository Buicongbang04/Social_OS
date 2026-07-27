import { Module } from "@nestjs/common";
import { ExecutionsController } from "./executions.controller";
import { GoalsController } from "./goals.controller";
import { GoalsService } from "./goals.service";

@Module({
  controllers: [GoalsController, ExecutionsController],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
