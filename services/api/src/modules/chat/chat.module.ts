import { Module } from "@nestjs/common";
import { ConnectionsModule } from "../connections/connections.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  // Chat reads the connected channels, so it needs whoever owns them. Reading
  // only: the tools it gets are read-only by construction.
  imports: [ConnectionsModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
