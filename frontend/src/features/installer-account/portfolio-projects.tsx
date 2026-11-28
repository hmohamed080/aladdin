"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Input, LabeledField, Textarea } from "@/components/ui/controls";
import { ProgressMeter } from "@/components/ui/primitives";
import {
  ChevronLeftIcon, ChevronRightIcon, EyeIcon, EyeOffIcon, MapPinIcon, PencilIcon, PlayIcon, PlusIcon, StarIcon,
  TrashIcon, UploadIcon, XIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/ui/cn";
import { uploadAsset } from "@/features/portfolio/upload";
import { uploadVideo, UploadFailure } from "@/features/video/upload-engine";
import { isVideoType } from "@/lib/media/video-policy";
import { finishPortfolioUpload } from "@/server/actions/portfolio";
import {
  createProjectAction, deleteProjectAction, removeProjectMediaAction, reorderProjectAction, reorderProjectsAction,
  setProjectCoverAction, setProjectVisibilityAction, startProjectPhotoUpload, updateProjectAction,
  type ProjectErrorCode,
} from "@/server/actions/portfolio-projects";
import type { PortfolioProject, ProjectMedia } from "@/server/queries/portfolio-projects";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Copy = { ar: string; en: string };
const ERRORS: Record<ProjectErrorCode | "type" | "upload", Copy> = {
  titleRequired: { ar: "اكتب اسم المشروع.", en: "Enter a project name." },
  tooLong: { ar: "النص أطول من المسموح.", en: "That text is too long." },
  projectLimit: { ar: "يمكنك إضافة 15 مشروعًا كحد أقصى.", en: "You can add up to 15 projects." },
  mediaLimit: { ar: "كل مشروع يقبل 6 صور وفيديوهات كحد أقصى.", en: "Each project holds up to 6 photos and videos." },
  notProfessional: { ar: "سابقة الأعمال متاحة للحسابات المهنية فقط.", en: "Work history is for professional accounts." },
  notFound: { ar: "لم يعد هذا العنصر موجودًا.", en: "This item no longer exists." },
  notEmpty: { ar: "احذف صور المشروع وفيديوهاته أولًا.", en: "Remove the project's photos and videos first." },
  retry: { ar: "حدث خطأ. حاول مرة أخرى.", en: "Something went wrong. Try again." },
  type: { ar: "اختر صورة JPG أو PNG أو WebP، أو فيديو MP4 أو MOV أو WebM.", en: "Choose a JPG, PNG or WebP photo, or an MP4, MOV or WebM video." },
  upload: { ar: "تعذر رفع الملف. حاول مرة أخرى.", en: "The file could not be uploaded. Try again." },
};

/**
 * The approved "Work history" section (`/preview/installer-account`, step 3) on the
 * real portfolio: up to 15 projects, each with up to 6 photos and videos, a chosen
 * cover, drag-and-drop upload and order, and one publish switch. The database
 * enforces every limit; this component only reflects them.
 */
export function PortfolioProjects({ projects, maxProjects, maxMedia, videoEnabled }: {
  projects: PortfolioProject[]; maxProjects: number; maxMedia: number; videoEnabled: boolean;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  // Stable across "new" -> created id, so the typed details survive the switch to editing.
  const [editorKey, setEditorKey] = useState(0);
  const open = (target: string | "new") => { setEditorKey((k) => k + 1); setEditing(target); };
  const [order, setOrder] = useState(() => projects.map((p) => p.id));
  const [dragged, setDragged] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setOrder(projects.map((p) => p.id)); }, [projects]);

  const byId = new Map(projects.map((p) => [p.id, p]));
  const ordered = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const current = editing && editing !== "new" ? byId.get(editing) ?? null : null;

  const dropOn = async (target: string) => {
    if (!dragged || dragged === target) return;
    const next = order.filter((id) => id !== dragged);
    next.splice(next.indexOf(target), 0, dragged);
    setOrder(next);
    setDragged(null);
    const result = await reorderProjectsAction(next);
    if (!result.ok) { setError(pick(ERRORS[result.code], ar)); setOrder(projects.map((p) => p.id)); }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-sm" data-testid="portfolio-projects">
      <div className="grid gap-xs wide:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(11rem,0.7fr)]">
        {ordered.map((project) => (
          <ProjectCard key={project.id} project={project} ar={ar} maxMedia={maxMedia}
            dragging={dragged === project.id}
            onDragStart={() => setDragged(project.id)} onDrop={() => dropOn(project.id)}
            onEdit={() => open(project.id)} />
        ))}
        <button type="button" disabled={projects.length >= maxProjects} onClick={() => open("new")}
          data-testid="portfolio-add-project"
          className="flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-strong bg-canvas p-md text-center text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50">
          <span className="grid h-14 w-14 place-items-center rounded-pill border border-bronze/50 text-bronze"><PlusIcon size={26} /></span>
          <strong className="mt-md text-body-lg">{ar ? "إضافة مشروع جديد" : "Add a new project"}</strong>
          <span className="mt-1 text-label text-fg-secondary">
            {projects.length >= maxProjects
              ? (ar ? `وصلت إلى الحد الأقصى (${maxProjects} مشروعًا)` : `You have reached ${maxProjects} projects`)
              : (ar ? "أضف صورًا ومعلومات عن مشروعك" : "Add photos and project details")}
          </span>
          <span dir="ltr" className="mt-2 text-caption tabular-nums text-fg-muted">{projects.length} / {maxProjects}</span>
        </button>
      </div>
      {error ? <p role="alert" className="text-label text-danger">{error}</p> : null}
      {editing ? (
        <ProjectEditor key={editorKey} project={current} waiting={editing !== "new" && !current} ar={ar} maxMedia={maxMedia} videoEnabled={videoEnabled}
          onCreated={(id) => { setEditing(id); router.refresh(); }}
          onChanged={() => router.refresh()}
          onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function pick(copy: Copy, ar: boolean) { return ar ? copy.ar : copy.en; }

function ProjectCard({ project, ar, maxMedia, dragging, onDragStart, onDrop, onEdit }: {
  project: PortfolioProject; ar: boolean; maxMedia: number; dragging: boolean;
  onDragStart: () => void; onDrop: () => void; onEdit: () => void;
}) {
  const cover = project.media.find((m) => project.cover && m.kind === project.cover.kind && m.id === project.cover.id) ?? project.media[0];
  const rest = project.media.filter((m) => m !== cover);
  const thumbs = rest.slice(0, 4);
  const extra = rest.length - thumbs.length;
  return (
    <article draggable onDragStart={onDragStart} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onDrop(); }}
      data-testid="portfolio-project"
      className={cn("relative grid overflow-hidden rounded-md border border-strong bg-canvas tablet:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]", dragging && "opacity-50")}>
      <span className={cn("absolute end-2 top-2 z-raised inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-caption font-semibold",
        project.isPublic ? "bg-success/10 text-success" : "bg-surface-2 text-fg-secondary")}>
        {project.isPublic ? <EyeIcon size={12} /> : <EyeOffIcon size={12} />}
        {project.isPublic ? (ar ? "منشور" : "Published") : (ar ? "خاص" : "Private")}
      </span>
      <div className="flex min-w-0 flex-col p-sm pe-xl">
        <h3 className="text-label font-semibold leading-snug text-fg"><bdi dir="auto">{project.title}</bdi></h3>
        {project.location ? <p className="mt-2 flex min-w-0 items-center gap-1 text-caption leading-snug text-fg-secondary"><MapPinIcon size={13} className="shrink-0" /><bdi dir="auto">{project.location}</bdi></p> : null}
        {project.description ? <p className="mt-2 line-clamp-3 text-pretty text-caption leading-relaxed text-fg-secondary"><bdi dir="auto">{project.description}</bdi></p> : null}
        <p dir="ltr" className="mt-2 w-fit text-caption tabular-nums text-fg-muted">{project.media.length} / {maxMedia}</p>
        <div className="mt-auto flex gap-1.5 pt-sm">
          <Button type="button" variant="ghost" size="sm" onClick={onEdit} aria-label={ar ? "تعديل المشروع" : "Edit project"} className="h-9 min-h-0 px-2.5" data-testid="portfolio-project-edit"><PencilIcon size={16} /></Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 p-2">
        <div className="relative h-28 w-full overflow-hidden rounded-sm bg-surface-2">
          {cover ? <MediaThumb media={cover} /> : <span className="grid h-full place-items-center text-caption text-fg-muted">{ar ? "لا توجد صور بعد" : "No photos yet"}</span>}
        </div>
        {thumbs.length ? (
          <div className="grid h-12 grid-cols-4 gap-1.5">
            {thumbs.map((m, index) => (
              <span key={m.id} className="relative overflow-hidden rounded-sm border bg-surface-2">
                <MediaThumb media={m} />
                {index === thumbs.length - 1 && extra > 0 ? <span className="absolute inset-0 grid place-items-center bg-primary/70 text-label font-semibold text-primary-foreground">+{extra}</span> : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function MediaThumb({ media }: { media: ProjectMedia }) {
  return (
    <>
      {media.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
        <img src={media.previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      {media.kind === "video" ? <span className="absolute inset-0 grid place-items-center text-on-accent"><span className="grid h-8 w-8 place-items-center rounded-pill bg-primary/70"><PlayIcon size={14} /></span></span> : null}
    </>
  );
}

type Upload = { key: string; name: string; progress: number; error: string | null };

function ProjectEditor({ project, waiting, ar, maxMedia, videoEnabled, onCreated, onChanged, onClose }: {
  /** The project being edited; null while creating one, or while a just-created one is loading. */
  project: PortfolioProject | null; waiting: boolean; ar: boolean; maxMedia: number; videoEnabled: boolean;
  onCreated: (id: string) => void; onChanged: () => void; onClose: () => void;
}) {
  const titleId = useId();
  const firstField = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState(project?.title ?? "");
  const [location, setLocation] = useState(project?.location ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [working, setBusy] = useState(false);
  const busy = working || waiting;
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [order, setOrder] = useState(() => project?.media ?? []);
  const [dragged, setDragged] = useState<string | null>(null);
  const [overDrop, setOverDrop] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { setMounted(true); firstField.current?.focus(); }, []);
  useEffect(() => { setOrder(project?.media ?? []); }, [project?.media]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const fail = (code: keyof typeof ERRORS) => setError(pick(ERRORS[code], ar));

  const saveDetails = async () => {
    setBusy(true); setError(null);
    const input = { title, location: location || null, description: description || null };
    const result = project ? await updateProjectAction(project.id, input) : await createProjectAction(input);
    setBusy(false);
    if (!result.ok) return fail(result.code);
    if (!project && result.id) onCreated(result.id); else onChanged();
  };

  const accept = videoEnabled ? [...PHOTO_TYPES, "video/mp4", "video/quicktime", "video/webm"] : PHOTO_TYPES;
  const room = maxMedia - (project?.media.length ?? 0) - uploads.filter((u) => !u.error).length;

  const addFiles = async (files: File[]) => {
    if (!project) return;
    setError(null);
    const usable = files.filter((f) => accept.includes(f.type));
    if (usable.length < files.length) fail("type");
    if (usable.length > room) fail("mediaLimit");
    const batch = usable.slice(0, Math.max(0, room)).map((file, i) => ({ file, key: `${Date.now()}-${i}-${file.name}` }));
    if (!batch.length) return;
    setUploads((u) => [...u, ...batch.map(({ file, key }) => ({ key, name: file.name, progress: 0, error: null }))]);
    const set = (key: string, patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    await Promise.all(batch.map(async ({ file, key }) => {
      const name = (file.name.replace(/\.[^.]+$/, "").trim() || project.title).slice(0, 120);
      try {
        if (isVideoType(file.type)) {
          await uploadVideo({ file, title: name, scope: "portfolio", projectId: project.id,
            onProgress: (f) => set(key, { progress: Math.round(f * 100) }), signal: new AbortController().signal });
        } else {
          const outcome = await uploadAsset("portfolio", file,
            (prepared) => startProjectPhotoUpload(project.id, { title: name, contentType: prepared.type, size: prepared.size }),
            finishPortfolioUpload, (p) => set(key, { progress: p }));
          if (!outcome.ok) {
            const known = ["mediaLimit", "projectLimit", "notProfessional", "notFound"].includes(outcome.code);
            return set(key, { error: pick(ERRORS[(known ? outcome.code : "upload") as keyof typeof ERRORS], ar) });
          }
        }
        setUploads((u) => u.filter((x) => x.key !== key));
      } catch (e) {
        set(key, { error: pick(e instanceof UploadFailure && e.code === "limit" ? ERRORS.mediaLimit : ERRORS.upload, ar) });
      }
    }));
    onChanged();
  };

  const persistOrder = async (next: ProjectMedia[]) => {
    if (!project) return;
    setOrder(next);
    const result = await reorderProjectAction(project.id, next.map(({ kind, id }) => ({ kind, id })));
    if (!result.ok) { fail(result.code); setOrder(project.media); }
    onChanged();
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target]!, next[index]!];
    void persistOrder(next);
  };

  const dropOnItem = (targetId: string) => {
    if (!dragged || dragged === targetId) return;
    const moving = order.find((m) => m.id === dragged);
    if (!moving) return;
    const next = order.filter((m) => m.id !== dragged);
    next.splice(next.findIndex((m) => m.id === targetId), 0, moving);
    setDragged(null);
    void persistOrder(next);
  };

  const run = async (task: () => Promise<{ ok: true } | { ok: false; code: ProjectErrorCode }>) => {
    setBusy(true); setError(null);
    const result = await task();
    setBusy(false);
    if (!result.ok) fail(result.code); else onChanged();
    return result.ok;
  };

  const onDropFiles = (e: DragEvent) => {
    e.preventDefault();
    setOverDrop(false);
    if (e.dataTransfer.files.length) void addFiles(Array.from(e.dataTransfer.files));
  };

  const Prev = ar ? ChevronRightIcon : ChevronLeftIcon;
  const Next = ar ? ChevronLeftIcon : ChevronRightIcon;

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-modal grid place-items-center bg-canvas/70 p-sm backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} dir={ar ? "rtl" : "ltr"} data-testid="portfolio-project-editor"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-strong bg-surface shadow-raised">
        <header className="flex items-center justify-between gap-sm border-b px-md py-sm">
          <h2 id={titleId} className="text-title text-fg">{project ? (ar ? "تعديل المشروع" : "Edit project") : (ar ? "مشروع جديد" : "New project")}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label={ar ? "إغلاق" : "Close"} className="grid h-9 w-9 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><XIcon size={18} /></button>
        </header>
        <div className="flex flex-col gap-md overflow-y-auto p-md">
          <div className="grid gap-sm tablet:grid-cols-2">
            <LabeledField label={ar ? "اسم المشروع" : "Project name"} htmlFor={`${titleId}-title`}>
              <Input ref={firstField} id={`${titleId}-title`} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="project-title" />
            </LabeledField>
            <LabeledField label={ar ? "الموقع" : "Location"} htmlFor={`${titleId}-location`} optional={ar ? "اختياري" : "optional"}>
              <Input id={`${titleId}-location`} value={location} maxLength={120} onChange={(e) => setLocation(e.target.value)} data-testid="project-location" />
            </LabeledField>
          </div>
          <LabeledField label={ar ? "وصف المشروع" : "Project description"} htmlFor={`${titleId}-description`} optional={ar ? "اختياري" : "optional"}>
            <Textarea id={`${titleId}-description`} rows={3} value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} data-testid="project-description" />
          </LabeledField>
          <div className="flex flex-wrap gap-sm">
            <Button type="button" onClick={saveDetails} disabled={busy} data-testid="project-save">
              {project ? (ar ? "حفظ التفاصيل" : "Save details") : (ar ? "إنشاء المشروع" : "Create project")}
            </Button>
            {project ? (
              <Button type="button" variant="outline" disabled={busy} data-testid="project-visibility"
                onClick={() => run(() => setProjectVisibilityAction(project.id, !project.isPublic))}>
                {project.isPublic ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                <span className="ms-1.5">{project.isPublic ? (ar ? "إخفاء من ملفي العام" : "Hide from public profile") : (ar ? "نشر في ملفي العام" : "Publish on public profile")}</span>
              </Button>
            ) : null}
          </div>

          {project ? (
            <>
              <section aria-label={ar ? "صور وفيديوهات المشروع" : "Project photos and videos"} className="flex flex-col gap-sm">
                <div className="flex items-baseline justify-between gap-sm">
                  <h3 className="text-body font-semibold text-fg">{ar ? "الصور والفيديوهات" : "Photos and videos"}</h3>
                  <span dir="ltr" className="text-label tabular-nums text-fg-secondary">{project.media.length} / {maxMedia}</span>
                </div>
                <div onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOverDrop(true); } }}
                  onDragLeave={() => setOverDrop(false)} onDrop={onDropFiles}
                  className={cn("flex flex-col items-center gap-xs rounded-md border border-dashed border-strong p-md text-center", overDrop && "border-accent bg-accent/5", room <= 0 && "opacity-60")}
                  data-testid="project-dropzone">
                  <UploadIcon size={22} className="text-bronze" />
                  <p className="text-label text-fg">{videoEnabled
                    ? (ar ? "اسحب الصور والفيديوهات هنا أو" : "Drag photos and videos here, or")
                    : (ar ? "اسحب الصور هنا أو" : "Drag photos here, or")}</p>
                  <Button type="button" variant="outline" size="sm" disabled={room <= 0} onClick={() => fileInput.current?.click()}>
                    {ar ? "اختر ملفات" : "Choose files"}
                  </Button>
                  <p className="text-caption text-fg-muted">{ar ? `حتى ${maxMedia} ملفات لكل مشروع` : `Up to ${maxMedia} files per project`}</p>
                  <input ref={fileInput} type="file" multiple accept={accept.join(",")} className="sr-only" aria-label={ar ? "رفع صور أو فيديوهات" : "Upload photos or videos"}
                    data-testid="project-file-input"
                    onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void addFiles(files); }} />
                </div>
                {uploads.length ? (
                  <ul className="flex flex-col gap-xs">
                    {uploads.map((u) => (
                      <li key={u.key} className="rounded-sm border p-xs">
                        <div className="flex items-center justify-between gap-sm text-label"><bdi dir="auto" className="truncate">{u.name}</bdi>
                          {u.error ? <button type="button" className="text-fg-secondary" aria-label={ar ? "إزالة" : "Dismiss"} onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}><XIcon size={14} /></button> : null}
                        </div>
                        {u.error ? <p role="alert" className="mt-1 text-caption text-danger">{u.error}</p> : <div className="mt-1"><ProgressMeter value={u.progress} label={ar ? "تقدم الرفع" : "Upload progress"} size="sm" /></div>}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {order.length ? (
                  <ul className="grid grid-cols-2 gap-sm tablet:grid-cols-3" data-testid="project-media">
                    {order.map((m, index) => {
                      const isCover = project.cover?.kind === m.kind && project.cover.id === m.id;
                      return (
                        <li key={m.id} draggable onDragStart={() => setDragged(m.id)} onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOnItem(m.id); }}
                          className={cn("flex flex-col overflow-hidden rounded-sm border bg-canvas", dragged === m.id && "opacity-50", isCover && "ring-2 ring-accent")}
                          data-testid="project-media-item">
                          <div className="relative aspect-[4/3] bg-surface-2">
                            <MediaThumb media={m} />
                            {m.state !== "ready" ? <span className="absolute bottom-1 start-1 rounded-pill bg-surface px-2 py-0.5 text-caption text-fg-secondary">{stateLabel(m, ar)}</span> : null}
                            {isCover ? <span className="absolute top-1 start-1 rounded-pill bg-accent-solid px-2 py-0.5 text-caption font-semibold text-on-accent">{ar ? "الغلاف" : "Cover"}</span> : null}
                          </div>
                          <div className="flex items-center gap-1 p-1">
                            <button type="button" onClick={() => move(index, -1)} disabled={index === 0 || busy} aria-label={ar ? "تحريك للأمام" : "Move earlier"} className="grid h-8 w-8 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 disabled:opacity-40"><Prev size={15} /></button>
                            <button type="button" onClick={() => move(index, 1)} disabled={index === order.length - 1 || busy} aria-label={ar ? "تحريك للخلف" : "Move later"} className="grid h-8 w-8 place-items-center rounded-sm text-fg-secondary hover:bg-surface-2 disabled:opacity-40"><Next size={15} /></button>
                            <button type="button" onClick={() => run(() => setProjectCoverAction(project.id, m.kind, m.id))} disabled={isCover || busy}
                              aria-label={ar ? "اجعلها صورة الغلاف" : "Use as cover"} aria-pressed={isCover} data-testid="project-set-cover"
                              className="grid h-8 w-8 place-items-center rounded-sm text-warning hover:bg-surface-2 disabled:opacity-60"><StarIcon size={15} /></button>
                            <button type="button" onClick={() => run(() => removeProjectMediaAction({ kind: m.kind, id: m.id, objectKey: m.objectKey }))} disabled={busy}
                              aria-label={ar ? "حذف" : "Delete"} className="ms-auto grid h-8 w-8 place-items-center rounded-sm text-danger hover:bg-danger/10"><TrashIcon size={15} /></button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {order.length > 1 ? <p className="text-caption text-fg-muted">{ar ? "اسحب العناصر لترتيبها، واختر النجمة لتحديد صورة الغلاف." : "Drag items to reorder them; pick the star to choose the cover."}</p> : null}
              </section>

              <div className="flex flex-wrap items-center gap-sm border-t pt-md">
                {confirmDelete ? (
                  <>
                    <span className="text-label text-fg">{ar ? "حذف المشروع وكل صوره وفيديوهاته؟" : "Delete the project with all its photos and videos?"}</span>
                    <Button type="button" variant="danger" size="sm" disabled={busy} data-testid="project-delete-confirm"
                      onClick={async () => { if (await run(() => deleteProjectAction(project.id))) onClose(); }}>{ar ? "حذف" : "Delete"}</Button>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDelete(false)}>{ar ? "إلغاء" : "Cancel"}</Button>
                  </>
                ) : (
                  <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => setConfirmDelete(true)} data-testid="project-delete">
                    <TrashIcon size={15} /><span className="ms-1.5">{ar ? "حذف المشروع" : "Delete project"}</span>
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-label text-fg-secondary">{ar ? "أنشئ المشروع أولًا، ثم أضف صوره وفيديوهاته." : "Create the project first, then add its photos and videos."}</p>
          )}
          {error ? <p role="alert" className="text-label text-danger" data-testid="project-error">{error}</p> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function stateLabel(m: ProjectMedia, ar: boolean) {
  switch (m.state) {
    case "pending": case "uploading": return ar ? "لم يكتمل الرفع" : "Upload unfinished";
    case "processing": return ar ? "جارٍ التجهيز" : "Processing";
    case "failed": return ar ? "تعذر التجهيز" : "Processing failed";
    default: return "";
  }
}
