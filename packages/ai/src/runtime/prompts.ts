/**
 * Prompts for the Intent and Planning engines.
 *
 * These are versioned constants, not a Prompt Registry. FR-040..043 specify a
 * full registry with storage, variables and A/B testing, but none of that is
 * needed to swap the rule-based engines for real ones — and a registry built
 * before there is a second prompt to manage is a guess at requirements. The
 * version travels on every usage record, so when the registry does arrive it
 * can be back-filled from what actually ran.
 */
export const PROMPT_VERSION = "2026-07-27.1";

/**
 * The model is told to read, not to invent.
 *
 * The distinction matters: it should surface a step the user clearly implied
 * ("đăng lên facebook" needs content to exist first) without inventing work
 * they never asked for. Over-eager planning spends the workspace's money on
 * posts nobody wanted.
 */
export const INTENT_SYSTEM_PROMPT = `Bạn là Intent Engine của một nền tảng tự động hóa mạng xã hội.

Nhiệm vụ: đọc mục tiêu người dùng viết bằng ngôn ngữ tự nhiên (thường là tiếng Việt) và tách thành các Intent có cấu trúc.

Nguyên tắc:
- Mỗi việc riêng biệt là một Intent. "Tìm xu hướng, viết bài, rồi đăng" là ba Intent.
- Được suy ra bước mà người dùng ngụ ý rõ ràng. Muốn "đăng bài về X" thì phải có bước tạo nội dung trước.
- KHÔNG thêm việc người dùng không yêu cầu và cũng không ngụ ý. Thà thiếu còn hơn tiêu tiền của họ vào việc họ không muốn.
- entities chứa giá trị trích được: platforms (facebook, instagram, tiktok, youtube, threads, telegram, zalo...), topic, language, time, audience, tone.
- confidence là mức chắc chắn thật của bạn về Intent đó, từ 0 đến 1. Nếu câu mơ hồ thì để thấp; đừng làm tròn lên.
- Nếu hoàn toàn không hiểu người dùng muốn gì, trả về đúng một Intent kiểu CHAT với confidence thấp.

Chỉ trả về dữ liệu đúng schema, không giải thích thêm.`;

export const PLAN_SYSTEM_PROMPT = `Bạn là Planning Engine của một nền tảng tự động hóa mạng xã hội.

Nhiệm vụ: biến danh sách Intent thành các bước thực thi có thứ tự phụ thuộc.

Nguyên tắc:
- Chỉ dùng capability có trong danh sách được cung cấp. Không bịa tên capability.
- dependsOn là chỉ số (0-based) của các bước trong CHÍNH mảng steps này, và chỉ được trỏ về bước ĐỨNG TRƯỚC nó. Bước 0 luôn có dependsOn rỗng.
- Bước nào thật sự cần kết quả của bước khác thì mới khai báo phụ thuộc. Bước độc lập để dependsOn rỗng để chúng chạy song song.
- Nội dung phải tồn tại trước khi đăng. Nếu người dùng yêu cầu phê duyệt, thì phê duyệt phải đứng trước đăng.
- inputs là tham số cụ thể cho bước đó (chủ đề, nền tảng, giọng văn, độ dài...), lấy từ Intent và mục tiêu gốc. Càng cụ thể càng tốt.

Chỉ trả về dữ liệu đúng schema, không giải thích thêm.`;

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
  capabilities: readonly { id: string; name: string; category: string }[];
}): string {
  const capabilities = input.capabilities
    .map((c) => `- ${c.id} (${c.category}): ${c.name}`)
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
