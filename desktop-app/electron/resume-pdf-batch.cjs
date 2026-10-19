'use strict';
const fs = require('node:fs');
const path = require('node:path');
const validName = name => /^[\w\u4e00-\u9fa5()（）\-· ]{1,120}$/.test(name) && name === name.trim()
  && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name);

function validatePdfItem(item) {
  const fileName = String(item?.fileName || '').trim();
  const html = String(item?.html || '');
  if (!/\.pdf$/i.test(fileName) || !validName(fileName.slice(0, -4))) throw new Error('PDF 文件名不合法');
  const folderName = item?.folderName;
  if (folderName !== undefined && (typeof folderName !== 'string' || !validName(folderName))) throw new Error('PDF 子目录名称不合法');
  if (html.length < 200 || !/<!DOCTYPE html>/i.test(html)) throw new Error('HTML 内容不完整，无法生成 PDF');
  return { fileName, html, ...(folderName !== undefined ? { folderName } : {}) };
}

/** wx 以排他方式创建文件；旧文件及本批同名输出均保留，避免先检查再写的竞态。 */
async function writeUniquePdf(directory, fileName, pdf, folderName) {
  if (!/\.pdf$/i.test(fileName) || !validName(fileName.slice(0, -4))) throw new Error('PDF 文件名不合法');
  const root = path.resolve(directory);
  if (folderName !== undefined) {
    if (!validName(folderName)) throw new Error('PDF 子目录名称不合法');
    // mkdir is exclusive: never reuse an existing directory (including a symlink).
    // Repeated/concurrent exports suffix the folder, keeping 姓名.pdf unchanged.
    for (let suffix = 0; suffix < 10000; suffix++) {
      const folder = path.resolve(root, suffix ? `${folderName} (${suffix + 1})` : folderName);
      if (path.dirname(folder) !== root) throw new Error('PDF 子目录必须位于所选目录内');
      try { await fs.promises.mkdir(folder); }
      catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      const filePath = path.join(folder, fileName);
      await fs.promises.writeFile(filePath, pdf, { flag: 'wx' });
      return filePath;
    }
    throw new Error('同名目录过多，请选择其他目录');
  }
  const stem = fileName.replace(/\.pdf$/i, '');
  for (let suffix = 0; suffix < 10000; suffix++) {
    const name = suffix ? `${stem} (${suffix + 1}).pdf` : fileName;
    const filePath = path.resolve(root, name);
    if (path.dirname(filePath) !== root) throw new Error('PDF 路径必须位于所选目录内');
    try {
      await fs.promises.writeFile(filePath, pdf, { flag: 'wx' });
      return filePath;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('同名文件过多，请选择其他目录');
}

module.exports = { validatePdfItem, writeUniquePdf };
