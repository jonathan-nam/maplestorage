import { redirect } from "next/navigation";

// Upload used to live here, on a page of its own, because a screenshot's owner had to be
// GUESSED from the HUD and then corrected. It now happens on the character you are already
// looking at, where there is nothing to guess. Kept as a redirect rather than deleted: the old
// path is in people's history and bookmarks, and a 404 is a worse answer than the right page.
export default function UploadPage() {
  redirect("/inventory");
}
