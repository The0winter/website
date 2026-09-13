import { parentPort, workerData } from "node:worker_threads";
import WordExtractor from "word-extractor";
import { parseManuscript } from "./manuscript.js";

try {
  const buffer = Buffer.from(workerData.buffer);
  let source,
    encoding = "";
  if (workerData.extension === "txt") {
    const bom = buffer.subarray(0, 2).toString("hex");
    encoding =
      workerData.encoding ||
      (bom === "fffe" ? "utf-16le" : bom === "feff" ? "utf-16be" : "utf-8");
    try {
      source = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch {
      if (workerData.encoding || encoding !== "utf-8")
        throw Error("文字编码无法读取，请选择正确编码或另存为 UTF-8");
      encoding = "gb18030";
      source = new TextDecoder(encoding, { fatal: true }).decode(buffer);
    }
  } else {
    const magic = buffer.subarray(0, 8).toString("hex");
    if (
      workerData.extension === "doc"
        ? magic !== "d0cf11e0a1b11ae1"
        : !magic.startsWith("504b0304")
    )
      throw Error(
        "文件内容与扩展名不符，请在 Word 中另存为真正的 DOC 或 DOCX 文件",
      );
    if (workerData.extension === "doc") {
      // Reject invalid allocation sizes before the legacy reader allocates buffers.
      if (
        buffer.length < 512 ||
        ![9, 12].includes(buffer.readUInt16LE(30)) ||
        buffer.readUInt16LE(32) !== 6
      )
        throw Error("Invalid OLE header");
      const sectors = Math.floor(buffer.length / 2 ** buffer.readUInt16LE(30));
      for (const offset of [44, 64, 72])
        if (buffer.readUInt32LE(offset) > sectors)
          throw Error("Invalid OLE allocation table");
    }
    source = (await new WordExtractor().extract(buffer)).getBody();
  }
  parentPort.postMessage({ result: { ...parseManuscript(source), encoding } });
} catch (error) {
  parentPort.postMessage({
    error:
      error.status === 400 || /编码|扩展名/.test(error.message)
        ? error.message
        : "无法读取此文稿，文件可能损坏或加密；请在 Word 中另存为 DOCX 或 TXT 后重试",
  });
}
