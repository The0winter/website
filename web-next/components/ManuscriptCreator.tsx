"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  ImagePlus,
  Loader2,
  PenLine,
  Upload,
  X,
} from "lucide-react";
import { safeFetch } from "@/lib/request";
import BookCover from "./BookCover";
import { LoadingLogo } from "./BrandLoading";
import "./manuscript-creator.css";

type Chapter = {
  title: string;
  content: string;
  sourceNumber: number | null;
  volumeTitle: string;
  volumeNumber: number;
};
type Draft = {
  title: string;
  description: string;
  cover_image: string;
  category: string;
  filename: string;
  chapters: Chapter[];
  revision: number;
};
type DraftSummary = {
  _id: string;
  title: string;
  updatedAt: string;
  totalCharacters: number;
};
const empty: Draft = {
  title: "",
  description: "",
  cover_image: "",
  category: "未分类",
  filename: "",
  chapters: [],
  revision: 0,
};
const length = (value: string) => Array.from(value).length;
const example =
  "第一卷 风起\n第一章 初遇\n清晨，街角的书店刚刚开门。\n她推开门，看见桌上那封信。\n第2章 来信\n信里只写着一句话。\n第二卷 远行\n第一章 启程\n天亮时，她踏上了旅途。";
async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({
    error:
      response.status === 413
        ? "文件过大，请使用 10 MB 以内的文稿"
        : "请求暂时失败，请重试",
  }));
  if (!response.ok) throw Error(result.error || "请求暂时失败，请重试");
  return result;
}

export function ManuscriptDraftList({
  refreshVersion,
  onOpen,
}: {
  refreshVersion: number;
  onOpen: (key: string) => void;
}) {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    safeFetch("/api/manuscripts")
      .then(responseJson)
      .then((data) => {
        if (active) {
          setDrafts(data.drafts);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("作品草稿加载失败");
      });
    return () => {
      active = false;
    };
  }, [refreshVersion, attempt]);
  if (error)
    return (
      <div className="manuscript-drafts" role="alert">
        {error}
        <button onClick={() => setAttempt((n) => n + 1)}>重试</button>
      </div>
    );
  if (!drafts.length) return null;
  return (
    <section className="manuscript-drafts" aria-label="作品草稿">
      <h3>
        作品草稿 <span>仅自己可见 · {drafts.length}/50</span>
      </h3>
      {drafts.map((draft) => (
        <div key={draft._id}>
          <FileText size={20} />
          <p>
            <strong>{draft.title}</strong>
            <small>
              {draft.totalCharacters.toLocaleString()} 字 ·{" "}
              {new Date(draft.updatedAt).toLocaleDateString("zh-CN")} 保存
            </small>
          </p>
          <button onClick={() => onOpen(draft._id.split(":").at(-1)!)}>
            继续整理
          </button>
          <button
            aria-label={`删除草稿${draft.title}`}
            onClick={async () => {
              if (
                !confirm(`删除《${draft.title}》的作品草稿？此操作无法恢复。`)
              )
                return;
              try {
                await responseJson(
                  await safeFetch(
                    "/api/manuscripts/" + draft._id.split(":").at(-1),
                    { method: "DELETE" },
                  ),
                );
                setAttempt((n) => n + 1);
              } catch (e) {
                setError(e instanceof Error ? e.message : "删除失败");
              }
            }}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </section>
  );
}

export default function ManuscriptCreator({
  draftKey,
  resume = false,
  embedded = false,
  fullPage = false,
  onClose,
  onComplete,
}: {
  draftKey: string;
  resume?: boolean;
  embedded?: boolean;
  fullPage?: boolean;
  onClose: () => void;
  onComplete: (published: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft>({ ...empty });
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(resume ? "loading" : "");
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mode, setMode] = useState<"file" | "write">("file");
  const [writeContent, setWriteContent] = useState("");
  const [showExample, setShowExample] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [sourceChanged, setSourceChanged] = useState(false);
  const lock = useRef(false);
  const exitState = useRef({ dirty, busy, onClose });
  useEffect(() => {
    exitState.current = { dirty, busy, onClose };
  }, [dirty, busy, onClose]);
  const form = useRef<HTMLFormElement>(null);
  const chapter = draft.chapters[selected];
  const volumes = useMemo(() => {
    const groups = new Map<
      number,
      {
        number: number;
        title: string;
        chapters: (Chapter & { index: number })[];
      }
    >();
    draft.chapters.forEach((c, index) => {
      if (!groups.has(c.volumeNumber))
        groups.set(c.volumeNumber, {
          number: c.volumeNumber,
          title: c.volumeTitle,
          chapters: [],
        });
      groups.get(c.volumeNumber)!.chapters.push({ ...c, index });
    });
    return [...groups.values()];
  }, [draft.chapters]);
  const total = draft.chapters.reduce((n, c) => n + c.content.length, 0);
  const invalidChapters = draft.chapters
    .map((c, i) =>
      !c.content.trim() ||
      c.title.length > 100 ||
      c.content.length > 60000
        ? i
        : -1,
    )
    .filter((i) => i >= 0);
  const fieldsValid =
    Boolean(draft.title.trim()) &&
    length(draft.title) <= 15 &&
    length(draft.description) <= 300;
  const patch = (data: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...data }));
    setDirty(true);
    setConfirmed(false);
  };
  const close = () => {
    if (
      !busy &&
      (!dirty ||
        confirm("还有未保存的内容，确定关闭？可以先保存草稿，之后继续整理。"))
    )
      onClose();
  };

  useEffect(() => {
    let active = true;
    safeFetch("/api/manuscripts")
      .then(responseJson)
      .then((data) => {
        if (active) setRemaining(data.remainingCharacters);
      })
      .catch(() => {});
    if (resume)
      safeFetch("/api/manuscripts/" + draftKey)
        .then(responseJson)
        .then((data) => {
          if (active) {
            setDraft({
              ...data,
              chapters: data.chapters.map((c: Chapter) => ({
                ...c,
                volumeTitle: c.volumeTitle || "第一卷",
                volumeNumber: c.volumeNumber || 1,
              })),
            });
            setStep(data.chapters.length ? 2 : 1);
          }
        })
        .catch((e) => {
          if (active) {
            setError(e.message);
            setLoadFailed(true);
          }
        })
        .finally(() => {
          if (active) setBusy("");
        });
    return () => {
      active = false;
    };
  }, [draftKey, resume]);
  useEffect(() => {
    if (!coverFile) return;
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (embedded || fullPage) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        const state = exitState.current;
        if (
          !state.busy &&
          (!state.dirty ||
            confirm(
              "还有未保存的内容，确定关闭？可以先保存草稿，之后继续整理。",
            ))
        )
          state.onClose();
      }
      if (e.key !== "Tab") return;
      const elements = Array.from(
        form.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href]",
        ) || [],
      ).filter((el) => el.getClientRects().length > 0);
      const first = elements[0],
        last = elements.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          !form.current?.contains(document.activeElement))
      ) {
        e.preventDefault();
        last?.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          !form.current?.contains(document.activeElement))
      ) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [embedded, fullPage]);
  useEffect(() => {
    form.current
      ?.querySelector<HTMLElement>("[data-step-heading], #manuscript-title")
      ?.focus({ preventScroll: true });
    form.current?.scrollTo({ top: 0 });
  }, [step]);

  async function parse() {
    if (lock.current) return;
    const input =
      mode === "write"
        ? new File([writeContent], "在线创作.txt", { type: "text/plain" })
        : file;
    if (!input) {
      setError("请先选择文稿文件");
      return;
    }
    if (
      !/\.(txt|doc|docx)$/i.test(input.name) ||
      input.size > 10 * 1024 * 1024 ||
      !input.size
    ) {
      setError("请选择 10 MB 以内、非空的 TXT、DOC 或 DOCX 文件");
      return;
    }
    lock.current = true;
    setBusy("parse");
    setError("");
    try {
      const body = new FormData();
      body.append("file", input);
      body.append("encoding", mode === "write" ? "utf-8" : encoding);
      const result = await responseJson(
        await safeFetch("/api/manuscripts/parse", {
          method: "POST",
          body,
          signal: AbortSignal.timeout(45000),
        }),
      );
      patch({ chapters: result.chapters, filename: input.name });
      setWarnings(result.warnings);
      setSourceChanged(false);
      setSelected(0);
      setEditing(false);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "文稿识别失败，请重试");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function save(action: "draft" | "publish") {
    if (lock.current) return;
    if (loadFailed) return;
    if (!fieldsValid) {
      setError("请填写 15 字以内的书名，简介不超过 300 字");
      return;
    }
    if (sourceChanged) {
      setError("文稿已更换，请先重新识别并核对，再保存");
      return;
    }
    if (
      action === "publish" &&
      (!confirmed ||
        !draft.description.trim() ||
        invalidChapters.length ||
        !draft.chapters.length)
    ) {
      setError("请补全简介和章节，并确认已核对预览");
      return;
    }
    lock.current = true;
    setBusy(action);
    setError("");
    try {
      let cover = draft.cover_image;
      if (coverFile) {
        const body = new FormData();
        body.append("file", coverFile);
        const uploaded = await responseJson(
          await safeFetch("/api/upload/cover?purpose=book", {
            method: "POST",
            body,
            signal: AbortSignal.timeout(90000),
          }),
        );
        cover = uploaded.url;
        setDraft((d) => ({ ...d, cover_image: cover }));
        setCoverFile(null);
        setCoverPreview("");
      }
      const body = new FormData();
      body.append(
        "manuscript",
        JSON.stringify({ ...draft, cover_image: cover, action }),
      );
      const result = await responseJson(
        await safeFetch("/api/manuscripts/" + draftKey, {
          method: "PUT",
          body,
          signal: AbortSignal.timeout(90000),
        }),
      );
      setDraft((d) => ({ ...d, revision: result.revision }));
      setDirty(false);
      // The mobile history handler runs before React commits this state update.
      if (form.current) {
        form.current.dataset.dirty = "false";
        form.current.dataset.busy = "false";
      }
      onComplete(result.status === "published");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  const updateChapter = (data: Partial<Chapter>) =>
    patch({
      chapters: draft.chapters.map((c, i) =>
        i === selected ? { ...c, ...data } : c,
      ),
    });

  return (
    <div
      className={`manuscript-overlay${embedded ? " manuscript-embedded" : ""}${fullPage ? " manuscript-page" : ""}`}
    >
      <form
        ref={form}
        className="manuscript-form"
        data-dirty={dirty}
        data-busy={Boolean(busy)}
        role={embedded || fullPage ? undefined : "dialog"}
        aria-modal={embedded || fullPage ? undefined : true}
        aria-label="创建新作品"
        onSubmit={(e) => e.preventDefault()}
      >
        {!embedded && (
          <header className="manuscript-header">
            <div>
              <LoadingLogo size={32} />
<div><span className="manuscript-eyebrow">九天 · 创作者空间</span><h2>创建新作品</h2></div>
            </div>
            <button
              type="button"
              aria-label="关闭新建作品"
              disabled={Boolean(busy)}
              onClick={close}
            >
              <X size={22} />
            </button>
          </header>
        )}
        <div className="manuscript-steps" aria-label="创建进度">
          <span aria-current={step === 1 ? "step" : undefined}>
            <i>{step > 1 ? <Check size={14} /> : 1}</i>资料与文稿
          </span>
          <b />
          <span aria-current={step === 2 ? "step" : undefined}>
            <i>2</i>检查并提交
          </span>
        </div>
        <div className={`manuscript-content manuscript-step-${step}`}>
          {busy === "loading" ? (
            <p role="status">正在读取作品草稿…</p>
          ) : loadFailed ? (
            <p>请关闭此窗口，重新打开草稿后继续。</p>
          ) : (
            <>
              {step === 2 && (
                <>
                  <h3 data-step-heading tabIndex={-1}>
                    这就是读者将看到的章节
                  </h3>
                  <p className="manuscript-intro">
                    已按卷、章顺序整理，可点选章节检查和修正。
                  </p>
                </>
              )}
              {step === 1 ? (
                <>
                  <section className="manuscript-details"><h3 className="manuscript-section-title">作品资料</h3><p className="manuscript-section-caption">为故事写下第一印象</p>
                  <div className="manuscript-field">
                    <label htmlFor="manuscript-title">
                      书名{" "}
                      <small
                        className={length(draft.title) > 15 ? "is-error" : ""}
                      >
                        {length(draft.title)} / 15
                      </small>
                    </label>
                    <input
                      id="manuscript-title"
                      aria-label="书名"
                      value={draft.title}
                      disabled={Boolean(busy)}
                      onChange={(e) => patch({ title: e.target.value })}
                      placeholder="给你的故事一个名字"
                      aria-invalid={length(draft.title) > 15}
                    />
                  </div>
                  <div className="manuscript-field">
                    <label htmlFor="manuscript-description">
                      简介{" "}
                      <small
                        className={
                          length(draft.description) > 300 ? "is-error" : ""
                        }
                      >
                        {length(draft.description)} / 300
                      </small>
                    </label>
                    <textarea
                      id="manuscript-description"
                      aria-label="简介"
                      rows={4}
                      value={draft.description}
                      disabled={Boolean(busy)}
                      onChange={(e) => patch({ description: e.target.value })}
                      placeholder="介绍故事、人物，或最想让读者知道的悬念"
                      aria-invalid={length(draft.description) > 300}
                    />
                  </div>
                  <div className="manuscript-meta">
                    <div className="manuscript-cover-field">
                      <label className="manuscript-cover">
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          aria-label="上传封面（非必须）"
                          disabled={Boolean(busy)}
                          onChange={(e) => {
                            const image = e.target.files?.[0];
                            e.target.value = "";
                            if (!image) return;
                            if (
                              ![
                                "image/jpeg",
                                "image/png",
                                "image/webp",
                              ].includes(image.type) ||
                              image.size > 8 * 1024 * 1024
                            ) {
                              setError("封面支持 8 MB 以内的 JPG、PNG、WebP");
                              return;
                            }
                            setCoverFile(image);
                            setDirty(true);
                            setConfirmed(false);
                          }}
                        />
                        {coverPreview || draft.cover_image ? (
                          <BookCover
                            src={coverPreview || draft.cover_image}
                            sizes="96px"
                          />
                        ) : (
                          <>
                            <ImagePlus size={23} />
                            <span>上传封面</span>
                          </>
                        )}
                      </label>
                      <div>
                        <strong>
                          封面 <small>非必须</small>
                        </strong>
                        <p>
                          JPG / PNG / WebP · 8 MB 内<br />
                          建议 3:4 竖图，可稍后补充
                        </p>
                        {(coverPreview || draft.cover_image) && (
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => {
                              setCoverFile(null);
                              setCoverPreview("");
                              patch({ cover_image: "" });
                            }}
                          >
                            移除封面
                          </button>
                        )}
                      </div>
                    </div>
                    <label className="manuscript-category">
                      作品分类
                      <select
                        value={draft.category}
                        disabled={Boolean(busy)}
                        onChange={(e) => patch({ category: e.target.value })}
                      >
                        {[
                          "未分类",
                          "玄幻",
                          "仙侠",
                          "都市",
                          "历史",
                          "科幻",
                          "奇幻",
                          "体育",
                          "军事",
                          "悬疑",
                        ].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  </section>
                  <section className="manuscript-import">
                    <div className="manuscript-import-heading">
                      <h4>导入正文</h4>
                      <button
                        type="button"
                        className="manuscript-example-toggle"
                        aria-expanded={showExample}
                        aria-controls="manuscript-example"
                        onClick={() => setShowExample((v) => !v)}
                      >
                        <BookOpen size={14} />
                        格式示例
                        <ChevronDown size={14} />
                      </button>
                      {showExample && (
                        <div
                          className="manuscript-guide"
                          id="manuscript-example"
                        >
                          <p>
                            卷名或章名请单独成行，便于系统识别整理，中文或数字均可
                          </p>
                          <pre>{example}</pre>
                          <a
                            download="文稿格式示例.txt"
                            href={
                              "data:text/plain;charset=utf-8," +
                              encodeURIComponent("\uFEFF" + example)
                            }
                          >
                            下载 TXT 示例
                          </a>
                        </div>
                      )}
                    </div>
                    <div className="manuscript-modes">
                      <button
                        type="button"
                        aria-pressed={mode === "file"}
                        disabled={Boolean(busy)}
                        onClick={() => {
                          setMode("file");
                          if (file) setSourceChanged(true);
                        }}
                      >
                        <Upload size={16} />
                        上传文件
                      </button>
                      <button
                        type="button"
                        aria-pressed={mode === "write"}
                        disabled={Boolean(busy)}
                        onClick={() => {
                          setMode("write");
                          if (writeContent) setSourceChanged(true);
                        }}
                      >
                        <PenLine size={16} />
                        直接码字
                      </button>
                    </div>
                    {mode === "file" ? (
                      <>
                        <label className="manuscript-drop">
                          <input
                            type="file"
                            accept=".txt,.doc,.docx,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                            aria-label="上传文稿"
                            disabled={Boolean(busy)}
                            onChange={(e) => {
                              const next = e.target.files?.[0];
                              e.target.value = "";
                              if (next) {
                                setFile(next);
                                setSourceChanged(true);
                                setDirty(true);
                                setError("");
                              }
                            }}
                          />
                          <Upload size={26} />
                          <strong>
                            {file?.name || draft.filename || "选择写好的文稿"}
                          </strong>
                          <span>支持 TXT、DOC、DOCX（Word） · 最大 10 MB</span>
                          <small>
                            {file
                              ? "点击更换文件"
                              : "选择后先预览，确认后再提交"}
                          </small>
                        </label>
                        <label className="manuscript-encoding">
                          TXT 编码
                          <select
                            aria-label="TXT 编码"
                            value={encoding}
                            disabled={Boolean(busy)}
                            onChange={(e) => {
                              setEncoding(e.target.value);
                              if (file) setSourceChanged(true);
                            }}
                          >
                            <option value="">自动识别</option>
                            <option value="utf-8">UTF-8</option>
                            <option value="gb18030">GBK / GB18030</option>
                            <option value="utf-16le">UTF-16 LE</option>
                            <option value="utf-16be">UTF-16 BE</option>
                          </select>
                          <span>预览乱码时可切换</span>
                        </label>
                      </>
                    ) : (
                      <div className="manuscript-chapter-editor">
                        <label>
                          文稿正文
                          <textarea
                            aria-label="在线章节正文"
                            rows={10}
                            value={writeContent}
                            disabled={Boolean(busy)}
                            onChange={(e) => {
                              setWriteContent(e.target.value);
                              setSourceChanged(true);
                              setDirty(true);
                            }}
                            placeholder={"在这里写作或粘贴文稿…\n\n" + example}
                          />
                        </label>
                      </div>
                    )}
                    {sourceChanged && draft.chapters.length > 0 && (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        className="manuscript-add"
                        onClick={() => {
                          setSourceChanged(false);
                          setStep(2);
                          setError("");
                        }}
                      >
                        保留上次识别结果，返回预览
                      </button>
                    )}
                  </section>
                </>
              ) : (
                <>
                  <div className="manuscript-book-summary">
                    <BookOpen size={22} />
                    <div>
                      <strong>{draft.title || "未命名作品"}</strong>
                      <span>
                        {volumes.length} 卷 · {draft.chapters.length} 章 ·{" "}
                        {total.toLocaleString()} 字 · {draft.filename}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => setStep(1)}
                    >
                      修改资料
                    </button>
                  </div>
                  {!!warnings.length && (
                    <details className="manuscript-warnings" open>
                      <summary>识别提醒 · {warnings.length} 项</summary>
                      <ul>
                        {warnings.map((warning, i) => (
                          <li key={i}>{warning}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {!!invalidChapters.length && (
                    <div role="alert" className="manuscript-error">
                      第{" "}
                      {invalidChapters
                        .slice(0, 15)
                        .map((i) => i + 1)
                        .join("、")}{" "}
                      项为空或超长。请修正后提交；草稿可以保留空章。
                    </div>
                  )}
                  <label className="manuscript-chapter-select">
                    选择章节
                    <select
                      value={selected}
                      disabled={Boolean(busy)}
                      onChange={(e) => {
                        setSelected(Number(e.target.value));
                        setEditing(false);
                      }}
                    >
                      {volumes.map((v) => (
                        <optgroup key={v.number} label={v.title}>
                          {v.chapters.map((c) => (
                            <option key={c.index} value={c.index}>
                              {c.title || `第${c.index + 1}章`}
                              {invalidChapters.includes(c.index)
                                ? "（待修正）"
                                : ""}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  {chapter && (
                    <section className="manuscript-preview">
                      <div className="manuscript-preview-tools">
                        <span>
                          {chapter.volumeTitle} · 第 {selected + 1} /{" "}
                          {draft.chapters.length} 项 ·{" "}
                          {chapter.content.length.toLocaleString()} 字
                        </span>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => setEditing((v) => !v)}
                        >
                          {editing ? "查看阅读效果" : "修正本章"}
                        </button>
                      </div>
                      {editing ? (
                        <div className="manuscript-chapter-editor">
                          <label>
                            章节标题
                            <input
                              aria-label="章节标题"
                              value={chapter.title}
                              disabled={Boolean(busy)}
                              onChange={(e) =>
                                updateChapter({ title: e.target.value })
                              }
                            />
                          </label>
                          <label>
                            章节正文
                            <textarea
                              aria-label="章节正文"
                              rows={12}
                              value={chapter.content}
                              disabled={Boolean(busy)}
                              onChange={(e) =>
                                updateChapter({ content: e.target.value })
                              }
                            />
                          </label>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => {
                              if (confirm("移除此章及其正文？")) {
                                patch({
                                  chapters: draft.chapters.filter(
                                    (_, i) => i !== selected,
                                  ),
                                });
                                setSelected(Math.max(0, selected - 1));
                              }
                            }}
                          >
                            移除此章
                          </button>
                        </div>
                      ) : (
                        <article>
                          <h4>{chapter.title || `第${selected + 1}章`}</h4>
                          <div>
                            {chapter.content ||
                              "本章没有正文，请点击「修正本章」补全或移除。"}
                          </div>
                        </article>
                      )}
                      <nav aria-label="预览章节翻页">
                        <button
                          type="button"
                          disabled={Boolean(busy) || selected === 0}
                          onClick={() => {
                            setSelected((i) => i - 1);
                            setEditing(false);
                          }}
                        >
                          上一章
                        </button>
                        <button
                          type="button"
                          disabled={
                            Boolean(busy) ||
                            selected >= draft.chapters.length - 1
                          }
                          onClick={() => {
                            setSelected((i) => i + 1);
                            setEditing(false);
                          }}
                        >
                          下一章
                        </button>
                      </nav>
                    </section>
                  )}
                  <button
                    type="button"
                    className="manuscript-add"
                    disabled={Boolean(busy) || draft.chapters.length >= 2000}
                    onClick={() => {
                      const volumeNumber = chapter?.volumeNumber || 1;
                      const volumeTitle = chapter?.volumeTitle || "第一卷";
                      const siblings = draft.chapters.filter(
                        (c) => c.volumeNumber === volumeNumber,
                      );
                      const nextNumber =
                        Math.max(
                          siblings.length,
                          ...siblings.map((c) => c.sourceNumber || 0),
                        ) + 1;
                      const insertAt =
                        draft.chapters.findLastIndex(
                          (c) => c.volumeNumber === volumeNumber,
                        ) + 1;
                      const chapters = [...draft.chapters];
                      chapters.splice(insertAt, 0, {
                        title: `第${nextNumber}章`,
                        content: "",
                        sourceNumber: nextNumber,
                        volumeNumber,
                        volumeTitle,
                      });
                      patch({
                        chapters,
                      });
                      setSelected(insertAt);
                      setEditing(true);
                    }}
                  >
                    ＋ 添加章节，继续码字
                  </button>
                  <label className="manuscript-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={Boolean(busy)}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    <span>我已核对章节顺序与正文，确认提交后向读者公开。</span>
                  </label>
                  {remaining !== null && (
                    <p className="manuscript-quota">
                      今日还可提交 {remaining.toLocaleString()} 字。
                      {total > remaining
                        ? "当前文稿超出额度，可先保存草稿。"
                        : "保存草稿不占提交额度。"}
                    </p>
                  )}
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="manuscript-error">
              {error}
            </p>
          )}
          {busy && busy !== "loading" && (
            <p role="status" className="manuscript-progress">
              <Loader2 size={16} />
              {busy === "parse"
                ? "正在读取文稿并识别章节…"
                : busy === "publish"
                  ? "正在提交作品，请稍候…"
                  : "正在保存整部作品草稿…"}
            </p>
          )}
        </div>
        <footer className="manuscript-footer">
          <div>
            <button
              type="button"
              className="manuscript-secondary"
              disabled={
                Boolean(busy) || loadFailed || !fieldsValid || sourceChanged
              }
              onClick={() => save("draft")}
            >
              保存草稿
            </button>
            {step === 1 ? (
              <button
                type="button"
                className="manuscript-primary"
                disabled={
                  Boolean(busy) ||
                  loadFailed ||
                  !fieldsValid ||
                  (mode === "file"
                    ? !file && !draft.chapters.length
                    : !writeContent.trim() && !draft.chapters.length)
                }
                onClick={() => {
                  if (!sourceChanged && draft.chapters.length) {
                    setStep(2);
                    return;
                  }
                  void parse();
                }}
              >
                {mode === "write" ? "预览章节" : "识别并预览"}
              </button>
            ) : (
              <button
                type="button"
                className="manuscript-primary"
                disabled={
                  Boolean(busy) ||
                  loadFailed ||
                  !fieldsValid ||
                  !confirmed ||
                  !draft.description.trim() ||
                  !!invalidChapters.length ||
                  !draft.chapters.length ||
                  (remaining !== null && total > remaining)
                }
                onClick={() => save("publish")}
              >
                提交作品
              </button>
            )}
          </div>
          {step === 1 ? (
            <small>草稿仅自己可见，提交后才会公开</small>
          ) : (
            <button
              type="button"
              className="manuscript-back"
              disabled={Boolean(busy)}
              onClick={() => setStep(1)}
            >
              <ArrowLeft size={14} />
              返回调整文稿
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}
