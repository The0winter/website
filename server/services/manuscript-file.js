import { Worker } from "node:worker_threads";
import { manuscriptLimits } from "./manuscript.js";

export function readManuscriptFile(file, encoding = "") {
  const extension = file?.originalname?.split(".").at(-1)?.toLowerCase();
  if (!["txt", "doc", "docx"].includes(extension))
    throw Object.assign(Error("请选择 TXT、DOC 或 DOCX 文稿"), { status: 400 });
  if (!file.buffer.length || file.buffer.length > manuscriptLimits.bytes)
    throw Object.assign(Error("文稿须大于 0 字节且不超过 10 MB"), {
      status: 400,
    });
  if (!["", "utf-8", "gb18030", "utf-16le", "utf-16be"].includes(encoding))
    throw Object.assign(Error("文字编码无效"), { status: 400 });
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./manuscript-worker.js", import.meta.url),
      {
        workerData: { buffer: file.buffer, extension, encoding },
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
        },
      },
    );
    const finish = (error, result) => {
      clearTimeout(timer);
      void worker.terminate();
      error ? reject(Object.assign(error, { status: 400 })) : resolve(result);
    };
    const timer = setTimeout(
      () => finish(Error("文稿解析超时，请缩小文件或另存为 TXT 后重试")),
      15000,
    );
    worker.once("message", (message) =>
      finish(message.error ? Error(message.error) : null, message.result),
    );
    worker.once("error", () =>
      finish(Error("文稿过于复杂，无法解析；请另存为 TXT 后重试")),
    );
    worker.once("exit", (code) => {
      if (code !== 0) finish(Error("文稿解析中断，请重试或另存为 TXT"));
    });
  });
}
