import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ValidationError, isId } from "@repo/core";
import type { WorkspaceId } from "@repo/core";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/public.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import { parseRouteId } from "../../common/parse-id";
import { DocumentsService } from "./documents.service";

/**
 * Upload, list and remove the files a workspace can search over.
 *
 * The whole file is buffered in memory before it is written, which is why
 * DocumentsModule caps the multipart body: without that cap the limit check in
 * the service would only run after the bytes had already been read, which is
 * the cost the limit exists to avoid.
 */
@Controller("documents")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @RequirePermission("workspace.file.create")
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    if (!file) {
      throw new ValidationError(
        "Thiếu file. Gửi multipart/form-data với trường tên là 'file'.",
      );
    }

    const result = await this.documents.upload(
      requireWorkspace(workspaceHeader),
      user.userId,
      {
        // Multer decodes the filename as latin1, so a Vietnamese name arrives
        // mojibaked. Re-reading those bytes as UTF-8 restores it.
        fileName: Buffer.from(file.originalname, "latin1").toString("utf8"),
        mimeType: file.mimetype,
        body: file.buffer,
      },
    );

    return { ...result.document, duplicate: result.duplicate };
  }

  @RequirePermission("workspace.file.read")
  @Get()
  async list(@Headers(WORKSPACE_ID_HEADER) workspaceHeader: string) {
    return this.documents.list(requireWorkspace(workspaceHeader));
  }

  @RequirePermission("workspace.file.read")
  @Get(":id")
  async get(
    @Param("id") id: string,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.documents.get(
      requireWorkspace(workspaceHeader),
      parseRouteId("document", id),
    );
  }

  @RequirePermission("workspace.file.read")
  @Get(":id/download-url")
  async downloadUrl(
    @Param("id") id: string,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return {
      url: await this.documents.downloadUrl(
        requireWorkspace(workspaceHeader),
        parseRouteId("document", id),
      ),
    };
  }

  @RequirePermission("workspace.file.delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ): Promise<void> {
    await this.documents.remove(
      requireWorkspace(workspaceHeader),
      parseRouteId("document", id),
      user.userId,
    );
  }
}

function requireWorkspace(header: string | undefined): WorkspaceId {
  if (!header || !isId("workspace", header)) {
    throw new ValidationError(`Thiếu hoặc sai header ${WORKSPACE_ID_HEADER}.`);
  }
  return header;
}


