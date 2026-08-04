import { redirect } from "next/navigation";

/**
 * "Viết bài" is a branch, not a page.
 *
 * It lands on composing rather than on researching, because writing is what
 * somebody came here to do and reading a competitor is the occasional step
 * before it.
 */
export default function WriteIndex() {
  redirect("/viet/bien-soan");
}
