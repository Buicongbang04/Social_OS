import { Module } from "@nestjs/common";
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
  imports: [ConnectionsModule],
  controllers: [CampaignsController, ContentPiecesController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
