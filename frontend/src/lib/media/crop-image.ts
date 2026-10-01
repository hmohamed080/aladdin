import type { Area } from "react-easy-crop";

export type CropImageOutput = {
  width: number;
  height: number;
  type: "image/jpeg" | "image/png" | "image/webp";
  quality?: number;
  backgroundColor?: string;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });
}

/** Renders one chosen source-image area into a predictable upload asset. */
export async function cropImageToBlob(src: string, area: Area, output: CropImageOutput): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = output.width;
  canvas.height = output.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");

  if (output.backgroundColor) {
    context.fillStyle = output.backgroundColor;
    context.fillRect(0, 0, output.width, output.height);
  }

  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, output.width, output.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("image encode failed"))),
      output.type,
      output.quality ?? 0.9,
    );
  });
}
