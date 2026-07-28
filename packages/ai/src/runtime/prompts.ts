/**
 * The user half of each Intent and Planning call.
 *
 * Only the user half. The system prompts moved to the Prompt Registry, where
 * they are addressable and versioned on their own; these stayed because they
 * are assembled with real branching — whether a schedule exists, which
 * capabilities happen to be registered — and flattening that into a template
 * would either lose the branches or hide them in the data.
 */
export function intentUserPrompt(input: {
  objective: string;
  title: string;
  constraints: Record<string, unknown>;
  schedule: { cron: string; timezone: string } | null;
}): string {
  const lines = [`Tiêu đề: ${input.title}`, `Mục tiêu: ${input.objective}`];

  if (Object.keys(input.constraints).length > 0) {
    lines.push(`Ràng buộc: ${JSON.stringify(input.constraints)}`);
  }
  if (input.schedule) {
    lines.push(
      `Lịch chạy: cron "${input.schedule.cron}" theo múi giờ ${input.schedule.timezone}`,
    );
  }

  return lines.join("\n");
}

export function planUserPrompt(input: {
  objective: string;
  intents: readonly { type: string; action: string; entities: unknown }[];
  capabilities: readonly {
    id: string;
    name: string;
    category: string;
    description?: string;
  }[];
}): string {
  const capabilities = input.capabilities
    .map(
      (c) =>
        `- ${c.id} (${c.category}): ${c.description ?? c.name}`,
    )
    .join("\n");

  const intents = input.intents
    .map(
      (intent, index) =>
        `${index + 1}. ${intent.type} / ${intent.action} — ${JSON.stringify(intent.entities)}`,
    )
    .join("\n");

  return [
    `Mục tiêu gốc: ${input.objective}`,
    "",
    "Các Intent đã nhận diện:",
    intents,
    "",
    "Capability khả dụng (chỉ được dùng trong danh sách này):",
    capabilities,
  ].join("\n");
}
