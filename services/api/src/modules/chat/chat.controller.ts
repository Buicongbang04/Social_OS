import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ValidationError, isId } from "@repo/core";
import type { WorkspaceId } from "@repo/core";
import { z } from "zod";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/public.decorator";
import { ApiZodBody } from "../../common/openapi/zod-body";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import { parseRouteId } from "../../common/parse-id";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { requestContext } from "../../common/context/request-context";
import { ChatService } from "./chat.service";

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
});

const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
});

@Controller("chat/conversations")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @RequirePermission("workspace.workflow.create")
  @ApiZodBody(createConversationSchema)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createConversationSchema))
    body: z.infer<typeof createConversationSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.chat.createConversation(
      requireWorkspace(workspaceHeader),
      user.userId,
      body.title,
    );
  }

  @RequirePermission("workspace.workflow.read")
  @Get()
  async list(@Headers(WORKSPACE_ID_HEADER) workspaceHeader: string) {
    return this.chat.listConversations(requireWorkspace(workspaceHeader));
  }

  @RequirePermission("workspace.workflow.read")
  @Get(":id/messages")
  async messages(
    @Param("id") id: string,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.chat.listMessages(
      requireWorkspace(workspaceHeader),
      parseRouteId("conversation", id),
    );
  }

  @RequirePermission("workspace.workflow.delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ): Promise<void> {
    await this.chat.deleteConversation(
      requireWorkspace(workspaceHeader),
      parseRouteId("conversation", id),
      user.userId,
    );
  }

  /**
   * Send a turn and stream the answer back as Server-Sent Events.
   *
   * Written straight to the response rather than returned, for two reasons.
   * The envelope interceptor would otherwise buffer the whole answer and hand
   * it over at the end — which is exactly what streaming exists not to do. And
   * an error that happens after the first byte cannot become a 500: the status
   * line is already sent, so failures travel as an `error` event instead.
   *
   * SSE rather than a WebSocket because the traffic is one-directional and
   * SSE reconnects, passes through proxies, and needs no protocol upgrade. The
   * gateway doc lists all three as supported; this is the one this endpoint
   * needs.
   */
  @RequirePermission("workspace.workflow.execute")
  @ApiZodBody(sendMessageSchema)
  @Post(":id/messages")
  async send(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(sendMessageSchema))
    body: z.infer<typeof sendMessageSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const workspaceId = requireWorkspace(workspaceHeader);
    const conversationId = parseRouteId("conversation", id);

    // Aborted when the browser goes away, so the vendor stops generating text
    // nobody will read — and stops charging for it.
    const abort = new AbortController();
    request.on("close", () => abort.abort());

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx buffers proxied responses by default, which holds every chunk
      // until the response ends and makes streaming look exactly like not
      // streaming.
      "x-accel-buffering": "no",
    });
    response.flushHeaders();

    const send = (event: string, data: unknown): void => {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const event of this.chat.send({
        workspaceId,
        userId: user.userId,
        conversationId,
        content: body.content,
        correlationId: requestContext.correlationId() ?? "",
        signal: abort.signal,
      })) {
        if (event.type === "delta") send("delta", { text: event.text });
        // Sent before the first token, so the reader can see what the answer
        // is about to be based on rather than learning it afterwards.
        if (event.type === "sources") {
          send("sources", { citations: event.citations });
        }
        // Sent as it happens, so the reader sees what the assistant did rather
        // than only what it concluded.
        if (event.type === "tool") send("tool", event.run);
        if (event.type === "done") send("done", event.message);
        if (event.type === "error") {
          send("error", { message: event.message, partial: event.partial });
        }
      }
    } catch (error: unknown) {
      // Reached only for failures before the first chunk — a missing
      // conversation, an unconfigured provider. The headers are already sent
      // by then, so this is an event rather than a status code.
      send("error", {
        message: error instanceof Error ? error.message : String(error),
        partial: null,
      });
    } finally {
      response.end();
    }
  }
}

function requireWorkspace(header: string | undefined): WorkspaceId {
  if (!header || !isId("workspace", header)) {
    throw new ValidationError(`Thiếu hoặc sai header ${WORKSPACE_ID_HEADER}.`);
  }
  return header;
}
