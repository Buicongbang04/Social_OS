import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { AppConfig } from "../../config/app.config";
import { AppConfigModule } from "../../config/config.module";
import { ConnectionsModule } from "../connections/connections.module";
import {
  CampaignsController,
  ContentPiecesController,
} from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";

@Module({
  // The report reads engagement straight from the platform, which is what the
  // connections module already knows how to do — a second copy of token
  // opening and Graph reading is a second place for it to go wrong.
  imports: [
    ConnectionsModule,
    // Buffered in memory, never onto this machine's disk: the API may be
    // several replicas behind a load balancer, and a temp file written by one
    // of them is not there for the next request. The cap refuses oversized
    // bytes mid-stream, which is the only place a limit does any good.
    MulterModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        storage: undefined,
        limits: { fileSize: config.uploadMaxBytes, files: 1 },
      }),
    }),
  ],
  controllers: [CampaignsController, ContentPiecesController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
