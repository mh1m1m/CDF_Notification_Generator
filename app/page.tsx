// The start page is the persona's work list; proxy.ts sends anyone without a valid session to /sign-in first.
import { redirect } from "next/navigation";

export default function StartPage(): never {
  redirect("/my-work");
}
