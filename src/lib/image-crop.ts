// Geração da imagem recortada NO NAVEGADOR (canvas) para a foto de perfil.
// A partir do recorte escolhido no react-easy-crop (área em pixels da imagem
// original + rotação), produz um quadrado outSize×outSize com FUNDO BRANCO
// (para PNG com transparência) e exporta em JPEG. Só esse arquivo final sobe —
// o original nunca é enviado. Usa APIs do browser; chamar só no cliente.

import type { Area } from "react-easy-crop";

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (e) => reject(e));
    image.src = url;
  });
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Caixa delimitadora da imagem depois de girada.
function rotatedSize(width: number, height: number, rotation: number) {
  const rad = toRad(rotation);
  return {
    width: Math.abs(Math.cos(rad) * width) + Math.abs(Math.sin(rad) * height),
    height: Math.abs(Math.sin(rad) * width) + Math.abs(Math.cos(rad) * height),
  };
}

// Desenha a imagem girada, recorta a área escolhida e redimensiona para outSize,
// sempre sobre fundo branco. Devolve o <canvas> pronto.
async function renderCroppedCanvas(
  imageSrc: string,
  pixelCrop: Area,
  rotation: number,
  outSize: number,
  bg: string
): Promise<HTMLCanvasElement> {
  const image = await createImage(imageSrc);

  // 1) imagem girada numa canvas do tamanho da caixa girada.
  const { width: bW, height: bH } = rotatedSize(image.width, image.height, rotation);
  const rotated = document.createElement("canvas");
  rotated.width = Math.ceil(bW);
  rotated.height = Math.ceil(bH);
  const rctx = rotated.getContext("2d");
  if (!rctx) throw new Error("canvas 2d indisponível");
  rctx.translate(rotated.width / 2, rotated.height / 2);
  rctx.rotate(toRad(rotation));
  rctx.translate(-image.width / 2, -image.height / 2);
  rctx.drawImage(image, 0, 0);

  // 2) saída: fundo branco + recorte redimensionado para outSize×outSize.
  const out = document.createElement("canvas");
  out.width = outSize;
  out.height = outSize;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("canvas 2d indisponível");
  octx.fillStyle = bg;
  octx.fillRect(0, 0, outSize, outSize);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(
    rotated,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outSize,
    outSize
  );
  return out;
}

export type CropOptions = {
  outSize?: number;
  bg?: string;
  type?: string;
  quality?: number;
};

// Blob final para upload: 512×512, JPEG 0.85, fundo branco.
export async function croppedImageBlob(
  imageSrc: string,
  pixelCrop: Area,
  rotation: number,
  { outSize = 512, bg = "#ffffff", type = "image/jpeg", quality = 0.85 }: CropOptions = {}
): Promise<Blob | null> {
  const canvas = await renderCroppedCanvas(imageSrc, pixelCrop, rotation, outSize, bg);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

// Data URL para a pré-visualização ao vivo (tamanho pequeno).
export async function croppedImageDataUrl(
  imageSrc: string,
  pixelCrop: Area,
  rotation: number,
  { outSize = 72, bg = "#ffffff", type = "image/jpeg", quality = 0.9 }: CropOptions = {}
): Promise<string> {
  const canvas = await renderCroppedCanvas(imageSrc, pixelCrop, rotation, outSize, bg);
  return canvas.toDataURL(type, quality);
}
