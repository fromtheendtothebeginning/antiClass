// img.js — 证据文件名是否为图片（预览/预取共用）

export const IMG_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

export function isImage(name) {
  return IMG_EXT.some((e) => name.toLowerCase().endsWith(e));
}
