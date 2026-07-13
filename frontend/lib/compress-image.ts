// Re-encode as JPEG before upload to keep the request payload down -- but never
// resize.
//
// The screenshot is parsed by matching the client's own icons and stack-count
// digit font (see vision/app/cv/). That font is 11px tall and does not
// survive resampling: at 0.95x every count already reads as garbage. Capping the
// longest edge at 1600px, as this used to, put our own sample screenshots at
// 0.68x and 0.49x -- one is rejected outright, the other cannot even locate the
// inventory grid. The cap existed to hold down Claude's vision input-token cost;
// classical CV has no token cost, so it buys nothing and breaks everything.
//
// JPEG *compression* is safe as long as the pixel grid is untouched: quality
// 75-95 reads every token count correctly on all three sample screenshots, and
// only becomes unreliable below ~72. 0.92 sits well inside that band and still
// takes a 3MB PNG to roughly 400KB.
const JPEG_QUALITY = 0.92;

export async function compressImage(file: File): Promise<{ base64: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  // Drawn 1:1. Any scaling here destroys the count font.
  ctx.drawImage(bitmap, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) {
    throw new Error("Failed to compress image");
  }

  return { base64: await blobToBase64(blob), mediaType: "image/jpeg" };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.substring(result.indexOf(",") + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
