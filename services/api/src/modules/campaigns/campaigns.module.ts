import { Module } from "@nestjs/common";
import {
  CampaignsController,
  ContentPiecesController,
} from "./campaigns.controller";

@Module({ controllers: [CampaignsController, ContentPiecesController] })
export class CampaignsModule {}
