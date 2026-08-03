import { Module } from "@nestjs/common";
import { SecretsModule } from "../secrets/secrets.module";
import { TrendsController } from "./trends.controller";
import { TrendsService } from "./trends.service";

@Module({
  imports: [SecretsModule],
  controllers: [TrendsController],
  providers: [TrendsService],
})
export class TrendsModule {}
